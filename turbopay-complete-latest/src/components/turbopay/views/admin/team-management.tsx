"use client";

import * as React from "react";
import { Users, UserPlus, Shield, Ban, Copy, Check } from "lucide-react";
import { toast } from "sonner";

import { apiFetch, useApi, mutateApi } from "@/lib/turbopay/client";
import { PageHeader, EmptyState } from "@/components/turbopay/parts/layout";
import { cn } from "@/lib/utils";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogClose,
} from "@/components/ui/dialog";

// ---------- types ----------
interface TeamMember {
  id: string;
  fullName: string;
  email: string;
  emailMasked: string;
  phone: string;
  phoneMasked: string;
  role: string;
  status: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  kycTier: number;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}
interface TeamList {
  items: TeamMember[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}
interface CurrentUser { id: string; fullName: string; email: string; role: string; }

const ROLES = ["ADMIN", "SUPPORT", "COMPLIANCE", "FINANCE"];

const ROLE_TONE: Record<string, string> = {
  ADMIN: "bg-primary text-primary-foreground",
  SUPPORT: "bg-success/15 text-success",
  COMPLIANCE: "bg-warning/15 text-warning-foreground",
  FINANCE: "bg-accent text-accent-foreground",
};

const STATUS_TONE: Record<string, string> = {
  ACTIVE: "bg-success/15 text-success",
  FROZEN: "bg-destructive/15 text-destructive",
  SUSPENDED: "bg-warning/15 text-warning-foreground",
  CLOSED: "bg-muted text-muted-foreground",
};

// ============================================================
// Main
// ============================================================
export function TeamManagement() {
  const listPath = "/api/admin/team?limit=100";
  const { data, isLoading, error } = useApi<TeamList>(listPath);
  const { data: me } = useApi<{ user: CurrentUser } | CurrentUser>("/api/auth/me");

  const currentUserId = React.useMemo(() => {
    if (!me) return null;
    return (me as any).user?.id ?? (me as any).id ?? null;
  }, [me]);

  const [inviteOpen, setInviteOpen] = React.useState(false);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Team Management"
        description="Invite staff, change roles, and deactivate members."
        icon={<Users className="h-5 w-5" />}
        actions={
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus className="mr-1 h-4 w-4" /> Invite team member
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="p-6 text-sm text-destructive">{(error as Error).message}</div>
          ) : isLoading || !data ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : data.items.length === 0 ? (
            <EmptyState icon={<Users className="h-6 w-6" />} title="No team members" description="Invite your first team member." />
          ) : (
            <ScrollArea className="max-h-[600px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last active</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((m) => (
                    <TeamRow key={m.id} member={m} isSelf={m.id === currentUserId} />
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
          {data && (
            <div className="flex items-center justify-between px-4 py-3 text-xs text-muted-foreground">
              <span>{data.total} team members</span>
              <span>Page {data.page}{data.hasMore ? " (more available)" : ""}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  );
}

// ============================================================
// Row with actions
// ============================================================
function TeamRow({ member, isSelf }: { member: TeamMember; isSelf: boolean }) {
  const [roleOpen, setRoleOpen] = React.useState(false);
  const [deactivateOpen, setDeactivateOpen] = React.useState(false);
  const [newRole, setNewRole] = React.useState(member.role);
  const [roleBusy, setRoleBusy] = React.useState(false);
  const [deactBusy, setDeactBusy] = React.useState(false);

  async function changeRole() {
    if (newRole === member.role) { setRoleOpen(false); return; }
    setRoleBusy(true);
    try {
      await apiFetch(`/api/admin/team/${member.id}`, { method: "PATCH", body: JSON.stringify({ role: newRole }) });
      toast.success(`Role changed to ${newRole}`);
      mutateApi("/api/admin/team");
      setRoleOpen(false);
    } catch (e: any) {
      if (e?.status === 401) return; // global auth-expired handler takes over
      toast.error(e.message ?? "Failed");
    } finally {
      setRoleBusy(false);
    }
  }

  async function deactivate() {
    setDeactBusy(true);
    try {
      await apiFetch(`/api/admin/team/${member.id}/deactivate`, { method: "PATCH" });
      toast.success("Member deactivated");
      mutateApi("/api/admin/team");
      setDeactivateOpen(false);
    } catch (e: any) {
      if (e?.status === 401) return; // global auth-expired handler takes over
      toast.error(e.message ?? "Failed");
    } finally {
      setDeactBusy(false);
    }
  }

  const inactive = member.status === "SUSPENDED" || member.status === "CLOSED";

  return (
    <TableRow>
      <TableCell className="font-medium">
        {member.fullName}
        {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
      </TableCell>
      <TableCell className="text-muted-foreground">{member.emailMasked}</TableCell>
      <TableCell><Badge className={cn("text-[10px]", ROLE_TONE[member.role] ?? "")}>{member.role}</Badge></TableCell>
      <TableCell><Badge variant="outline" className={cn("text-[10px]", STATUS_TONE[member.status] ?? "")}>{member.status}</Badge></TableCell>
      <TableCell className="text-xs text-muted-foreground">{new Date(member.updatedAt).toLocaleString("en-NG")}</TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => { setNewRole(member.role); setRoleOpen(true); }}>
            <Shield className="mr-1 h-3.5 w-3.5" /> Change role
          </Button>
          <Button size="sm" variant="outline" disabled={isSelf || inactive} onClick={() => setDeactivateOpen(true)}>
            <Ban className="mr-1 h-3.5 w-3.5" /> Deactivate
          </Button>
        </div>
      </TableCell>

      {/* Change role dialog */}
      <Dialog open={roleOpen} onOpenChange={setRoleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change role — {member.fullName}</DialogTitle>
            <DialogDescription>Select a new role. Demoting the last admin is not allowed.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={newRole} onValueChange={setNewRole}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={changeRole} disabled={roleBusy || newRole === member.role}>
              {roleBusy ? "Saving…" : "Save role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deactivate dialog */}
      <Dialog open={deactivateOpen} onOpenChange={setDeactivateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deactivate {member.fullName}?</DialogTitle>
            <DialogDescription>
              This suspends the account, freezes their wallet, and revokes all active sessions.
              The action is recorded in the audit trail.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button variant="destructive" onClick={deactivate} disabled={deactBusy}>
              {deactBusy ? "Deactivating…" : "Confirm deactivation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TableRow>
  );
}

// ============================================================
// Invite dialog
// ============================================================
function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [fullName, setFullName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [role, setRole] = React.useState("SUPPORT");
  const [busy, setBusy] = React.useState(false);
  const [tempPassword, setTempPassword] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setFullName(""); setEmail(""); setPhone(""); setRole("SUPPORT"); setTempPassword(null); setCopied(false);
    }
  }, [open]);

  async function submit() {
    if (!fullName.trim() || !email.trim() || !phone.trim()) {
      toast.error("All fields are required");
      return;
    }
    setBusy(true);
    try {
      const result = await apiFetch<{ id: string; temporaryPassword: string }>(`/api/admin/team/invite`, {
        method: "POST", body: JSON.stringify({ fullName, email, phone, role }),
      });
      toast.success("Team member invited");
      setTempPassword(result.temporaryPassword);
      mutateApi("/api/admin/team");
    } catch (e: any) {
      if (e?.status === 401) return; // global auth-expired handler takes over
      toast.error(e.message ?? "Invite failed");
    } finally {
      setBusy(false);
    }
  }

  function copyPassword() {
    if (!tempPassword) return;
    navigator.clipboard?.writeText(tempPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    toast.success("Temporary password copied");
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!tempPassword) onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite team member</DialogTitle>
          <DialogDescription>
            {tempPassword
              ? "The invitee must reset this temporary password on first login."
              : "A temporary password will be generated and shown once."}
          </DialogDescription>
        </DialogHeader>

        {tempPassword ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-3">
              <p className="text-xs font-medium text-warning-foreground">Temporary password</p>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 rounded bg-background px-2 py-1.5 font-mono text-sm">{tempPassword}</code>
                <Button size="icon" variant="outline" onClick={copyPassword}>
                  {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">Share this out-of-band with the invitee. It will not be shown again.</p>
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="inv-name">Full name</Label>
                <Input id="inv-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inv-email">Email</Label>
                <Input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inv-phone">Phone</Label>
                <Input id="inv-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+234…" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Role</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
              <Button onClick={submit} disabled={busy || !fullName.trim() || !email.trim() || !phone.trim()}>
                {busy ? "Inviting…" : "Send invite"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
