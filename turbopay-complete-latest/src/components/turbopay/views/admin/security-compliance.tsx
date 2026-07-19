"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Shield, Award, Image, MessageSquare, Plus, Trash2, Edit, CheckCircle,
  XCircle, Clock, ExternalLink, Eye, EyeOff, GripVertical, Save, X
} from "lucide-react";
import { useApi, apiPost, mutateApi } from "@/lib/turbopay/client";
import { PageHeader } from "@/components/turbopay/parts/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────

interface Certificate {
  id: string;
  name: string;
  description: string | null;
  status: "PENDING" | "VERIFIED" | "EXPIRED" | "INACTIVE";
  logoUrl: string | null;
  verificationUrl: string | null;
  certificateNumber: string | null;
  dateIssued: string | null;
  expiryDate: string | null;
  displayOnHomepage: boolean;
  displayPriority: number;
  internalNotes: string | null;
}

interface SecurityBadge {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  enabled: boolean;
  displayPriority: number;
}

interface ProviderLogo {
  id: string;
  name: string;
  logoUrl: string | null;
  websiteUrl: string | null;
  category: string | null;
  enabled: boolean;
  displayPriority: number;
}

interface TrustMessage {
  id: string;
  title: string;
  message: string;
  type: "info" | "warning" | "success";
  enabled: boolean;
  displayPriority: number;
}

// ─── Status Config ──────────────────────────────────────────

const STATUS_CONFIG: Record<string, { color: string; icon: React.ReactNode }> = {
  VERIFIED: { color: "bg-success/10 text-success", icon: <CheckCircle className="h-4 w-4" /> },
  PENDING: { color: "bg-yellow-100 text-yellow-700", icon: <Clock className="h-4 w-4" /> },
  EXPIRED: { color: "bg-destructive/10 text-destructive", icon: <XCircle className="h-4 w-4" /> },
  INACTIVE: { color: "bg-muted text-muted-foreground", icon: <XCircle className="h-4 w-4" /> },
};

// ─── Main Admin Page ────────────────────────────────────────

export function SecurityComplianceAdmin() {
  const { data, isLoading } = useApi<{
    certificates: Certificate[];
    badges: SecurityBadge[];
    logos: ProviderLogo[];
    messages: TrustMessage[];
  }>("/api/admin/trust");

  const [tab, setTab] = React.useState("certificates");

  return (
    <div className="space-y-5">
      <PageHeader
        title="Security & Compliance"
        description="Manage compliance certificates, security badges, provider logos, and trust messages."
        icon={<Shield className="h-5 w-5" />}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full max-w-2xl grid-cols-4">
          <TabsTrigger value="certificates">
            <Award className="mr-1.5 h-4 w-4" /> Certificates
          </TabsTrigger>
          <TabsTrigger value="badges">
            <Shield className="mr-1.5 h-4 w-4" /> Badges
          </TabsTrigger>
          <TabsTrigger value="logos">
            <Image className="mr-1.5 h-4 w-4" /> Logos
          </TabsTrigger>
          <TabsTrigger value="messages">
            <MessageSquare className="mr-1.5 h-4 w-4" /> Messages
          </TabsTrigger>
        </TabsList>

        <TabsContent value="certificates" className="mt-4">
          <CertificatesTab data={data?.certificates ?? []} loading={isLoading} />
        </TabsContent>
        <TabsContent value="badges" className="mt-4">
          <BadgesTab data={data?.badges ?? []} loading={isLoading} />
        </TabsContent>
        <TabsContent value="logos" className="mt-4">
          <LogosTab data={data?.logos ?? []} loading={isLoading} />
        </TabsContent>
        <TabsContent value="messages" className="mt-4">
          <MessagesTab data={data?.messages ?? []} loading={isLoading} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Certificates Tab ───────────────────────────────────────

function CertificatesTab({ data, loading }: { data: Certificate[]; loading: boolean }) {
  const [editItem, setEditItem] = React.useState<Certificate | null>(null);
  const [showForm, setShowForm] = React.useState(false);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this certificate?")) return;
    try {
      await apiPost("/api/admin/trust", { entity: "certificate", _action: "delete", id });
      mutateApi("/api/admin/trust");
      toast.success("Certificate deleted");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Compliance Certificates</CardTitle>
        <Button size="sm" onClick={() => { setEditItem(null); setShowForm(true); }}>
          <Plus className="mr-1 h-4 w-4" /> Add Certificate
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />)}
          </div>
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No certificates configured. Add one to get started.</p>
        ) : (
          <div className="space-y-2">
            {data.map((cert) => {
              const statusCfg = STATUS_CONFIG[cert.status] ?? STATUS_CONFIG.PENDING;
              return (
                <div key={cert.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div className="flex items-center gap-3">
                    <div className={cn("flex h-8 w-8 items-center justify-center rounded-full", statusCfg.color)}>
                      {statusCfg.icon}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{cert.name}</p>
                      <p className="text-xs text-muted-foreground">{cert.status} {cert.certificateNumber ? `· ${cert.certificateNumber}` : ""}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {cert.displayOnHomepage && <Badge variant="secondary" className="text-[10px]">Homepage</Badge>}
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditItem(cert); setShowForm(true); }}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(cert.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <CertificateForm
        open={showForm}
        onClose={() => setShowForm(false)}
        item={editItem}
        onSaved={() => { setShowForm(false); mutateApi("/api/admin/trust"); }}
      />
    </Card>
  );
}

function CertificateForm({ open, onClose, item, onSaved }: {
  open: boolean;
  onClose: () => void;
  item: Certificate | null;
  onSaved: () => void;
}) {
  const [form, setForm] = React.useState({
    name: "", description: "", status: "PENDING" as string,
    verificationUrl: "", certificateNumber: "", dateIssued: "", expiryDate: "",
    displayOnHomepage: false, displayPriority: 0, internalNotes: "",
  });
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (item) {
      setForm({
        name: item.name, description: item.description ?? "", status: item.status,
        verificationUrl: item.verificationUrl ?? "", certificateNumber: item.certificateNumber ?? "",
        dateIssued: item.dateIssued ?? "", expiryDate: item.expiryDate ?? "",
        displayOnHomepage: item.displayOnHomepage, displayPriority: item.displayPriority,
        internalNotes: item.internalNotes ?? "",
      });
    } else {
      setForm({ name: "", description: "", status: "PENDING", verificationUrl: "", certificateNumber: "", dateIssued: "", expiryDate: "", displayOnHomepage: false, displayPriority: 0, internalNotes: "" });
    }
  }, [item, open]);

  const save = async () => {
    if (!form.name) return toast.error("Name is required");
    setSaving(true);
    try {
      const payload: any = { entity: "certificate", ...form };
      if (item) payload.id = item.id;
      await apiPost("/api/admin/trust", payload);
      toast.success(item ? "Certificate updated" : "Certificate created");
      onSaved();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item ? "Edit Certificate" : "Add Certificate"}</DialogTitle>
          <DialogDescription>{item ? "Update certificate details" : "Add a new compliance certificate"}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Certificate Name *</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. PCI DSS, ISO 27001" />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="PENDING">Pending</option>
                <option value="VERIFIED">Verified</option>
                <option value="EXPIRED">Expired</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Input type="number" value={form.displayPriority} onChange={(e) => setForm({ ...form, displayPriority: Number(e.target.value) })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Certificate Number</Label>
            <Input value={form.certificateNumber} onChange={(e) => setForm({ ...form, certificateNumber: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Verification URL</Label>
            <Input value={form.verificationUrl} onChange={(e) => setForm({ ...form, verificationUrl: e.target.value })} placeholder="https://..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Date Issued</Label>
              <Input type="date" value={form.dateIssued} onChange={(e) => setForm({ ...form, dateIssued: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Expiry Date</Label>
              <Input type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Display on Homepage</p>
              <p className="text-xs text-muted-foreground">Show this certificate on the public homepage</p>
            </div>
            <Switch checked={form.displayOnHomepage} onCheckedChange={(v) => setForm({ ...form, displayOnHomepage: v })} />
          </div>
          <div className="space-y-1.5">
            <Label>Internal Notes</Label>
            <Textarea value={form.internalNotes} onChange={(e) => setForm({ ...form, internalNotes: e.target.value })} rows={2} placeholder="Admin-only notes..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Badges Tab ─────────────────────────────────────────────

function BadgesTab({ data, loading }: { data: SecurityBadge[]; loading: boolean }) {
  const [editItem, setEditItem] = React.useState<SecurityBadge | null>(null);
  const [showForm, setShowForm] = React.useState(false);

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await apiPost("/api/admin/trust", { entity: "badge", id, enabled });
      mutateApi("/api/admin/trust");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this badge?")) return;
    try {
      await apiPost("/api/admin/trust", { entity: "badge", _action: "delete", id });
      mutateApi("/api/admin/trust");
      toast.success("Badge deleted");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Security Badges</CardTitle>
        <Button size="sm" onClick={() => { setEditItem(null); setShowForm(true); }}>
          <Plus className="mr-1 h-4 w-4" /> Add Badge
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />)}
          </div>
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No badges configured.</p>
        ) : (
          <div className="space-y-2">
            {data.map((badge) => (
              <div key={badge.id} className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex items-center gap-3">
                  <div className={cn("flex h-8 w-8 items-center justify-center rounded-full", badge.enabled ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}>
                    <Shield className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{badge.name}</p>
                    <p className="text-xs text-muted-foreground">{badge.icon ?? "Shield"} · Priority {badge.displayPriority}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={badge.enabled} onCheckedChange={(v) => handleToggle(badge.id, v)} />
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditItem(badge); setShowForm(true); }}>
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(badge.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <BadgeForm open={showForm} onClose={() => setShowForm(false)} item={editItem} onSaved={() => { setShowForm(false); mutateApi("/api/admin/trust"); }} />
    </Card>
  );
}

function BadgeForm({ open, onClose, item, onSaved }: {
  open: boolean; onClose: () => void; item: SecurityBadge | null; onSaved: () => void;
}) {
  const [form, setForm] = React.useState({ name: "", description: "", icon: "Shield", enabled: true, displayPriority: 0 });
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (item) setForm({ name: item.name, description: item.description ?? "", icon: item.icon ?? "Shield", enabled: item.enabled, displayPriority: item.displayPriority });
    else setForm({ name: "", description: "", icon: "Shield", enabled: true, displayPriority: 0 });
  }, [item, open]);

  const save = async () => {
    if (!form.name) return toast.error("Name is required");
    setSaving(true);
    try {
      const payload: any = { entity: "badge", ...form };
      if (item) payload.id = item.id;
      await apiPost("/api/admin/trust", payload);
      toast.success(item ? "Badge updated" : "Badge created");
      onSaved();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{item ? "Edit Badge" : "Add Badge"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. SSL Secured" /></div>
          <div className="space-y-1.5"><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Icon (Lucide)</Label><Input value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} placeholder="Shield" /></div>
            <div className="space-y-1.5"><Label>Priority</Label><Input type="number" value={form.displayPriority} onChange={(e) => setForm({ ...form, displayPriority: Number(e.target.value) })} /></div>
          </div>
          <div className="flex items-center gap-2"><Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} /><span className="text-sm">Enabled</span></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Logos Tab ──────────────────────────────────────────────

function LogosTab({ data, loading }: { data: ProviderLogo[]; loading: boolean }) {
  const [editItem, setEditItem] = React.useState<ProviderLogo | null>(null);
  const [showForm, setShowForm] = React.useState(false);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this logo?")) return;
    try {
      await apiPost("/api/admin/trust", { entity: "logo", _action: "delete", id });
      mutateApi("/api/admin/trust");
      toast.success("Logo deleted");
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Provider Logos</CardTitle>
        <Button size="sm" onClick={() => { setEditItem(null); setShowForm(true); }}>
          <Plus className="mr-1 h-4 w-4" /> Add Logo
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />)}</div>
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No provider logos configured.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {data.map((logo) => (
              <div key={logo.id} className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex items-center gap-3">
                  {logo.logoUrl ? <img src={logo.logoUrl} alt={logo.name} className="h-6 w-auto" /> : <div className="h-6 w-12 rounded bg-muted" />}
                  <div>
                    <p className="text-sm font-medium">{logo.name}</p>
                    <p className="text-xs text-muted-foreground">{logo.category ?? "general"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditItem(logo); setShowForm(true); }}><Edit className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(logo.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      <LogoForm open={showForm} onClose={() => setShowForm(false)} item={editItem} onSaved={() => { setShowForm(false); mutateApi("/api/admin/trust"); }} />
    </Card>
  );
}

function LogoForm({ open, onClose, item, onSaved }: {
  open: boolean; onClose: () => void; item: ProviderLogo | null; onSaved: () => void;
}) {
  const [form, setForm] = React.useState({ name: "", logoUrl: "", websiteUrl: "", category: "", enabled: true, displayPriority: 0 });
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (item) setForm({ name: item.name, logoUrl: item.logoUrl ?? "", websiteUrl: item.websiteUrl ?? "", category: item.category ?? "", enabled: item.enabled, displayPriority: item.displayPriority });
    else setForm({ name: "", logoUrl: "", websiteUrl: "", category: "", enabled: true, displayPriority: 0 });
  }, [item, open]);

  const save = async () => {
    if (!form.name) return toast.error("Name is required");
    setSaving(true);
    try {
      const payload: any = { entity: "logo", ...form };
      if (item) payload.id = item.id;
      await apiPost("/api/admin/trust", payload);
      toast.success(item ? "Logo updated" : "Logo created");
      onSaved();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{item ? "Edit Logo" : "Add Logo"}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Paystack" /></div>
          <div className="space-y-1.5"><Label>Logo URL</Label><Input value={form.logoUrl} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} placeholder="https://..." /></div>
          <div className="space-y-1.5"><Label>Website URL</Label><Input value={form.websiteUrl} onChange={(e) => setForm({ ...form, websiteUrl: e.target.value })} placeholder="https://..." /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Category</Label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="mobile_money" /></div>
            <div className="space-y-1.5"><Label>Priority</Label><Input type="number" value={form.displayPriority} onChange={(e) => setForm({ ...form, displayPriority: Number(e.target.value) })} /></div>
          </div>
          <div className="flex items-center gap-2"><Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} /><span className="text-sm">Enabled</span></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Messages Tab ───────────────────────────────────────────

function MessagesTab({ data, loading }: { data: TrustMessage[]; loading: boolean }) {
  const [editItem, setEditItem] = React.useState<TrustMessage | null>(null);
  const [showForm, setShowForm] = React.useState(false);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this message?")) return;
    try {
      await apiPost("/api/admin/trust", { entity: "message", _action: "delete", id });
      mutateApi("/api/admin/trust");
      toast.success("Message deleted");
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Trust Messages</CardTitle>
        <Button size="sm" onClick={() => { setEditItem(null); setShowForm(true); }}>
          <Plus className="mr-1 h-4 w-4" /> Add Message
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">{Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />)}</div>
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No trust messages configured.</p>
        ) : (
          <div className="space-y-2">
            {data.map((msg) => (
              <div key={msg.id} className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex items-center gap-3">
                  <div className={cn("flex h-8 w-8 items-center justify-center rounded-full",
                    msg.type === "info" && "bg-blue-100 text-blue-600",
                    msg.type === "warning" && "bg-amber-100 text-amber-600",
                    msg.type === "success" && "bg-green-100 text-green-600"
                  )}>
                    <MessageSquare className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{msg.title}</p>
                    <p className="text-xs text-muted-foreground truncate max-w-md">{msg.message}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditItem(msg); setShowForm(true); }}><Edit className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(msg.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      <MessageForm open={showForm} onClose={() => setShowForm(false)} item={editItem} onSaved={() => { setShowForm(false); mutateApi("/api/admin/trust"); }} />
    </Card>
  );
}

function MessageForm({ open, onClose, item, onSaved }: {
  open: boolean; onClose: () => void; item: TrustMessage | null; onSaved: () => void;
}) {
  const [form, setForm] = React.useState({ title: "", message: "", type: "info" as string, enabled: true, displayPriority: 0 });
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (item) setForm({ title: item.title, message: item.message, type: item.type, enabled: item.enabled, displayPriority: item.displayPriority });
    else setForm({ title: "", message: "", type: "info", enabled: true, displayPriority: 0 });
  }, [item, open]);

  const save = async () => {
    if (!form.title || !form.message) return toast.error("Title and message are required");
    setSaving(true);
    try {
      const payload: any = { entity: "message", ...form };
      if (item) payload.id = item.id;
      await apiPost("/api/admin/trust", payload);
      toast.success(item ? "Message updated" : "Message created");
      onSaved();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{item ? "Edit Message" : "Add Message"}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label>Title *</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Message *</Label><Textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} rows={3} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="success">Success</option>
              </select>
            </div>
            <div className="space-y-1.5"><Label>Priority</Label><Input type="number" value={form.displayPriority} onChange={(e) => setForm({ ...form, displayPriority: Number(e.target.value) })} /></div>
          </div>
          <div className="flex items-center gap-2"><Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} /><span className="text-sm">Enabled</span></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
