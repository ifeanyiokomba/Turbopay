"use client";

import * as React from "react";
import { BellRing, Megaphone, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";

import { apiFetch, useApi, mutateApi } from "@/lib/turbopay/client";
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

// ---------- types ----------
interface NotificationRow {
  id: string;
  userId: string | null;
  user: { id: string; fullName: string; emailMasked: string; phoneMasked: string } | null;
  channel: string;
  recipient: string;
  template: string;
  status: string;
  provider: string | null;
  messageId: string | null;
  errorMsg: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}
interface NotificationList {
  items: NotificationRow[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  stats: {
    byStatus: { status: string; count: number }[];
    byChannel: { channel: string; count: number }[];
  };
}

const STATUS_TONE: Record<string, string> = {
  SENT: "bg-success/15 text-success",
  PENDING: "bg-warning/15 text-warning-foreground",
  FAILED: "bg-destructive/15 text-destructive",
};

const CHANNELS = ["SMS", "EMAIL", "PUSH"];
const STATUSES = ["SENT", "PENDING", "FAILED"];

// ============================================================
// Main
// ============================================================
export function NotificationCenter() {
  const [channel, setChannel] = React.useState("");
  const [template, setTemplate] = React.useState("");
  const [status, setStatus] = React.useState("");

  const qs = new URLSearchParams();
  if (channel) qs.set("channel", channel);
  if (template) qs.set("template", template);
  if (status) qs.set("status", status);
  qs.set("limit", "100");
  const path = `/api/admin/notifications?${qs.toString()}`;

  const { data, isLoading, error } = useApi<NotificationList>(path);

  const failed = React.useMemo(() => (data?.items ?? []).filter((n) => n.status === "FAILED"), [data]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notification Center"
        description="Monitor SMS, email, and push delivery across the platform."
        icon={<BellRing className="h-5 w-5" />}
      />

      {/* Broadcast announcement composer */}
      <BroadcastAnnouncementCard />

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Channel</Label>
              <Select value={channel || "ALL"} onValueChange={(v) => setChannel(v === "ALL" ? "" : v)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All channels</SelectItem>
                  {CHANNELS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Template</Label>
              <Input placeholder="e.g. OTP, FUNDING…" value={template} onChange={(e) => setTemplate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select value={status || "ALL"} onValueChange={(v) => setStatus(v === "ALL" ? "" : v)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All statuses</SelectItem>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Failed section */}
      {data && failed.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-base">
              <span>Failed notifications ({failed.length})</span>
              <Button size="sm" variant="ghost" onClick={() => mutateApi(path)}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="max-h-72">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Template</TableHead>
                    <TableHead>Error</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {failed.map((n) => (
                    <FailedRow key={n.id} n={n} onDone={() => mutateApi(path)} />
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Main table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">All notifications</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {error ? (
            <div className="p-6 text-sm text-destructive">{(error as Error).message}</div>
          ) : isLoading || !data ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : data.items.length === 0 ? (
            <EmptyState icon={<BellRing className="h-6 w-6" />} title="No notifications" description="Adjust filters to see results." />
          ) : (
            <ScrollArea className="max-h-[600px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Channel</TableHead>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Template</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Sent at</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((n) => (
                    <TableRow key={n.id}>
                      <TableCell><Badge variant="secondary" className="text-[10px]">{n.channel}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{n.recipient}</TableCell>
                      <TableCell className="text-xs">{n.template}</TableCell>
                      <TableCell><Badge variant="outline" className={cn("text-[10px]", STATUS_TONE[n.status] ?? "")}>{n.status}</Badge></TableCell>
                      <TableCell className="text-xs">{n.provider ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(n.createdAt).toLocaleString("en-NG")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
          {data && (
            <div className="flex items-center justify-between px-4 py-3 text-xs text-muted-foreground">
              <span>{data.total} notifications</span>
              <span>Page {data.page}{data.hasMore ? " (more available)" : ""}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FailedRow({ n, onDone }: { n: NotificationRow; onDone: () => void }) {
  const [busy, setBusy] = React.useState(false);

  async function retry() {
    setBusy(true);
    try {
      const result = await apiFetch<{ delivered: boolean; error: string | null }>(`/api/admin/notifications/${n.id}/retry`, { method: "POST" });
      if (result.delivered) toast.success("Retry delivered");
      else toast.error(result.error ?? "Retry failed");
      onDone();
    } catch (e: any) {
      if (e?.status === 401) return; // global auth-expired handler takes over
      toast.error(e.message ?? "Retry failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{n.recipient}</TableCell>
      <TableCell><Badge variant="secondary" className="text-[10px]">{n.channel}</Badge></TableCell>
      <TableCell className="text-xs">{n.template}</TableCell>
      <TableCell className="max-w-[240px] truncate text-xs text-destructive">{n.errorMsg ?? "—"}</TableCell>
      <TableCell className="text-xs text-muted-foreground">{new Date(n.createdAt).toLocaleString("en-NG")}</TableCell>
      <TableCell className="text-right">
        <Button size="sm" variant="outline" disabled={busy} onClick={retry}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" /> {busy ? "Retrying…" : "Retry"}
        </Button>
      </TableCell>
    </TableRow>
  );
}

// ============================================================
// Broadcast announcement composer
// ============================================================
const PRIORITY_OPTIONS = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
type Priority = (typeof PRIORITY_OPTIONS)[number];

function BroadcastAnnouncementCard() {
  const [title, setTitle] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [priority, setPriority] = React.useState<Priority>("NORMAL");
  const [actionUrl, setActionUrl] = React.useState("");
  const [actionLabel, setActionLabel] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const canSubmit = title.trim().length >= 2 && message.trim().length >= 2 && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      const result = await apiFetch<{ sent: number }>("/api/admin/notifications/broadcast", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          message: message.trim(),
          priority,
          actionUrl: actionUrl.trim() || undefined,
          actionLabel: actionLabel.trim() || undefined,
        }),
      });
      toast.success(`Announcement broadcast to ${result.sent} active user${result.sent === 1 ? "" : "s"}.`);
      // Reset the form on success.
      setTitle("");
      setMessage("");
      setPriority("NORMAL");
      setActionUrl("");
      setActionLabel("");
    } catch (err: any) {
      if (err?.status === 401) return; // global auth-expired handler takes over
      if (err?.status === 403) {
        toast.error("You don't have permission to broadcast announcements.");
      } else {
        toast.error(err.message ?? "Broadcast failed");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Megaphone className="h-4 w-4 text-primary" />
          Broadcast announcement
          <Badge variant="outline" className="ml-1 text-[10px]">All active users</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ba-title" className="text-xs">Title</Label>
            <Input
              id="ba-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Scheduled maintenance window"
              maxLength={140}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ba-message" className="text-xs">Message</Label>
            <Textarea
              id="ba-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Write the announcement copy. All active users will see this in their notification bell."
              rows={3}
              maxLength={1000}
              required
            />
            <p className="text-[11px] text-muted-foreground">{message.length}/1000 characters</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="ba-priority" className="text-xs">Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
                <SelectTrigger id="ba-priority" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ba-action-url" className="text-xs">Action URL <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                id="ba-action-url"
                value={actionUrl}
                onChange={(e) => setActionUrl(e.target.value)}
                placeholder="/dashboard"
                maxLength={200}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ba-action-label" className="text-xs">Action label <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                id="ba-action-label"
                value={actionLabel}
                onChange={(e) => setActionLabel(e.target.value)}
                placeholder="Learn more"
                maxLength={60}
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button type="submit" disabled={!canSubmit}>
              {busy ? <RefreshCw className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
              {busy ? "Broadcasting…" : "Broadcast now"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
