"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Shield, ShieldCheck, ShieldAlert, ShieldOff, Smartphone, Monitor,
  LogIn, LogOut, AlertTriangle, KeyRound, Trash2, Fingerprint,
} from "lucide-react";
import { useApi, apiFetch, mutateApi } from "@/lib/turbopay/client";
import { usePasskeyRegistration, isPasskeySupported } from "@/hooks/use-passkey";
import { PageHeader, EmptyState } from "@/components/turbopay/parts/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel,
} from "@/components/ui/alert-dialog";

// ─── Types ───────────────────────────────────────────────────
interface Device { id: string; deviceName: string; ip: string | null; trusted: boolean; firstSeenAt: string; lastSeenAt: string }
interface TimelineEntry { id: string; ts: string; type: string; ip: string | null; deviceName: string | null; meta: Record<string, unknown> | null }
interface RiskScore { score: number; level: "low" | "medium" | "high"; factors: string[] }
interface SessionInfo { id: string; ip: string | null; userAgent: string | null; deviceInfo: string | null; createdAt: string; expiresAt: string; isCurrent: boolean }

// ─── Helpers ─────────────────────────────────────────────────
function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7); if (w < 5) return `${w}w ago`;
  const mo = Math.floor(d / 30); if (mo < 12) return `${mo}mo ago`;
  return new Date(iso).toLocaleDateString();
}

type TlIcon = React.ComponentType<{ className?: string }>;
const TIMELINE_META: Record<string, { label: string; icon: TlIcon; tone: string }> = {
  LOGIN_SUCCESS:     { label: "Successful sign-in",            icon: LogIn,         tone: "text-emerald-600" },
  LOGIN_FAILED:      { label: "Failed sign-in attempt",        icon: AlertTriangle, tone: "text-red-600" },
  LOGOUT:            { label: "Signed out",                    icon: LogOut,        tone: "text-muted-foreground" },
  DEVICE_RECOGNIZED: { label: "Returning device recognized",   icon: Smartphone,    tone: "text-muted-foreground" },
  DEVICE_NEW:        { label: "New device sign-in",            icon: Smartphone,    tone: "text-amber-600" },
  DEVICE_TRUSTED:    { label: "Device trusted",                icon: ShieldCheck,   tone: "text-emerald-600" },
  DEVICE_REVOKED:    { label: "Device revoked",                icon: ShieldOff,     tone: "text-red-600" },
  SESSION_REVOKED:   { label: "Session terminated",            icon: LogOut,        tone: "text-muted-foreground" },
  PIN_CHANGED:       { label: "Transaction PIN changed",       icon: KeyRound,      tone: "text-muted-foreground" },
  PASSWORD_CHANGED:  { label: "Password changed",              icon: KeyRound,      tone: "text-muted-foreground" },
  STEP_UP_REQUIRED:  { label: "Step-up verification required", icon: ShieldAlert,   tone: "text-amber-600" },
  STEP_UP_PASSED:    { label: "Step-up verification passed",   icon: ShieldCheck,   tone: "text-emerald-600" },
  STEP_UP_FAILED:    { label: "Step-up verification failed",   icon: ShieldAlert,   tone: "text-red-600" },
};

const RISK_STYLES = {
  low:    { badge: "bg-emerald-600 text-white", bar: "bg-emerald-500", text: "text-emerald-600", label: "Low risk" },
  medium: { badge: "bg-amber-500 text-white",   bar: "bg-amber-500",   text: "text-amber-600",   label: "Medium risk" },
  high:   { badge: "bg-red-600 text-white",     bar: "bg-red-500",     text: "text-red-600",     label: "High risk" },
} as const;

const TL_KEY = "/api/security/timeline?limit=50";

type RevokeTarget = { kind: "device" | "session"; id: string; name: string };

// ─── Main view ───────────────────────────────────────────────
export function SecurityView() {
  const [revoke, setRevoke] = React.useState<RevokeTarget | null>(null);
  const [revoking, setRevoking] = React.useState(false);

  const confirmRevoke = async () => {
    if (!revoke) return;
    const isDevice = revoke.kind === "device";
    const path = isDevice ? `/api/security/devices/${revoke.id}` : `/api/auth/sessions?id=${revoke.id}`;
    const revalidate = isDevice ? ["/api/security/devices", TL_KEY] : ["/api/auth/sessions", TL_KEY];
    setRevoking(true);
    try {
      await apiFetch(path, { method: "DELETE" });
      revalidate.forEach(mutateApi);
      toast.success(isDevice ? "Device revoked" : "Session terminated");
    } catch (e: any) {
      if (e?.status === 401) return; // global auth-expired handler takes over
      toast.error(e.message ?? "Could not revoke");
    } finally {
      setRevoking(false);
      setRevoke(null);
    }
  };

  const desc = revoke?.kind === "device" ? `“${revoke?.name}” will be removed. It may be flagged as new on the next sign-in.` : `“${revoke?.name}” will be signed out immediately.`;

  return (
    <div className="space-y-5">
      <PageHeader title="Security Center" description="Monitor account safety — devices, sessions & recent activity." icon={<Shield className="h-5 w-5" />} />

      <RiskCard />
      <PasskeysCard />
      <DevicesCard onRevoke={(id, name) => setRevoke({ kind: "device", id, name })} />
      <TimelineCard />
      <SessionsCard onRevoke={(id, name) => setRevoke({ kind: "session", id, name })} />

      <AlertDialog open={!!revoke} onOpenChange={(o) => !o && setRevoke(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              Revoke {revoke?.kind === "device" ? "device" : "session"}?
            </AlertDialogTitle>
            <AlertDialogDescription>{desc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>Cancel</AlertDialogCancel>
            <Button className="bg-destructive text-white hover:bg-destructive/90" onClick={confirmRevoke} disabled={revoking}>
              {revoking ? "Revoking…" : "Revoke"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Risk score card ─────────────────────────────────────
function RiskCard() {
  const { data, isLoading } = useApi<RiskScore>("/api/security/risk");
  if (isLoading) return <Skeleton className="h-32 w-full" />;
  const r = data ?? { score: 0, level: "low" as const, factors: [] };
  const s = RISK_STYLES[r.level];
  return (
    <Card>
      <CardContent className="py-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Account risk score</p>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className={`text-4xl font-bold tabular-nums ${s.text}`}>{r.score}</span>
              <span className="text-sm text-muted-foreground">/ 100</span>
            </div>
          </div>
          <Badge className={`px-3 py-1 text-sm ${s.badge}`}>{s.label}</Badge>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className={`h-full rounded-full transition-all ${s.bar}`} style={{ width: `${Math.max(r.score, 3)}%` }} />
        </div>
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Contributing factors</p>
          {r.factors.length === 0 ? (
            <p className="text-sm text-emerald-600">No risk factors detected — your account looks safe.</p>
          ) : (
            <ul className="space-y-1">
              {r.factors.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm"><AlertTriangle className={`h-3.5 w-3.5 shrink-0 ${s.text}`} /> {f}</li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function DevicesCard({ onRevoke }: { onRevoke: (id: string, name: string) => void }) {
  const { data, isLoading } = useApi<Device[]>("/api/security/devices");
  const [trusting, setTrusting] = React.useState<string | null>(null);
  const devices = data ?? [];

  const trust = async (id: string) => {
    setTrusting(id);
    try {
      await apiFetch(`/api/security/devices/${id}?action=trust`, { method: "PATCH" });
      mutateApi("/api/security/devices");
      mutateApi(TL_KEY);
      toast.success("Device trusted");
    } catch (e: any) {
      if (e?.status === 401) return; // global auth-expired handler takes over
      toast.error(e.message ?? "Could not trust device");
    } finally {
      setTrusting(null);
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Smartphone className="h-4 w-4" /> Registered devices</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : devices.length === 0 ? (
          <EmptyState icon={<Smartphone className="h-5 w-5" />} title="No registered devices" description="Devices appear here after you sign in." />
        ) : (
          devices.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Monitor className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{d.deviceName}</p>
                <p className="truncate text-xs text-muted-foreground tabular-nums">{d.ip ?? "Unknown IP"} · Last seen {relTime(d.lastSeenAt)}</p>
              </div>
              <Badge variant={d.trusted ? "secondary" : "outline"} className={d.trusted ? "border-transparent bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : ""}>
                {d.trusted ? "Trusted" : "Untrusted"}
              </Badge>
              <div className="flex gap-1.5">
                {!d.trusted && (
                  <Button size="sm" variant="outline" onClick={() => trust(d.id)} disabled={trusting === d.id}>
                    {trusting === d.id ? "Trusting…" : "Trust"}
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => onRevoke(d.id, d.deviceName)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function TimelineCard() {
  const { data, isLoading } = useApi<TimelineEntry[]>(TL_KEY);
  const events = data ?? [];
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldAlert className="h-4 w-4" /> Security activity</CardTitle></CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : events.length === 0 ? (
          <EmptyState icon={<Shield className="h-5 w-5" />} title="No activity yet" description="Security events will appear here as they happen." />
        ) : (
          <div className="max-h-96 overflow-y-auto pr-1 scrollbar-thin">
            <ol className="space-y-0.5">
              {events.map((e) => {
                const m = TIMELINE_META[e.type] ?? { label: e.type, icon: Shield, tone: "text-muted-foreground" };
                const Icon = m.icon;
                return (
                  <li key={e.id} className="flex gap-3 rounded-lg px-2 py-2 hover:bg-accent/50">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted ${m.tone}`}><Icon className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                        <p className="text-sm font-medium">{m.label}</p>
                        <p className="text-xs text-muted-foreground">{relTime(e.ts)}</p>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{e.deviceName ?? "Unknown device"}{e.ip ? ` · ${e.ip}` : ""}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SessionsCard({ onRevoke }: { onRevoke: (id: string, name: string) => void }) {
  const { data, isLoading } = useApi<SessionInfo[]>("/api/auth/sessions");
  const sessions = data ?? [];
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Monitor className="h-4 w-4" /> Active sessions</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : sessions.length === 0 ? (
          <EmptyState icon={<Monitor className="h-5 w-5" />} title="No active sessions" />
        ) : (
          sessions.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Monitor className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {s.deviceInfo || "Unknown device"}
                  {s.isCurrent && <Badge variant="secondary" className="ml-2 text-[10px]">This device</Badge>}
                </p>
                <p className="truncate text-xs text-muted-foreground tabular-nums">{s.ip ?? "Unknown IP"} · Started {relTime(s.createdAt)}</p>
              </div>
              {!s.isCurrent && (
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => onRevoke(s.id, s.deviceInfo || "this session")}><Trash2 className="h-4 w-4" /></Button>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

// ─── Passkeys card ──────────────────────────────────────────
interface PasskeyInfo { id: string; deviceName: string; createdAt: string; lastUsedAt: string | null }

function PasskeysCard() {
  const { data, isLoading } = useApi<PasskeyInfo[]>("/api/auth/passkeys");
  const passkeys = data ?? [];
  const supported = isPasskeySupported();
  const { register, isRegistering } = usePasskeyRegistration({
    onSuccess: () => { mutateApi("/api/auth/passkeys"); toast.success("Passkey added successfully"); },
    onError: (e) => { if (e.message !== "NotAllowedError") toast.error(e.message ?? "Could not register passkey"); },
  });

  const handleRegister = async () => {
    const name = prompt("Name this passkey (e.g. 'My iPhone'):", "My device");
    if (!name) return;
    await register(name);
  };

  const handleRemove = async (passkeyId: string) => {
    try {
      await apiFetch("/api/auth/passkeys", {
        method: "DELETE",
        body: JSON.stringify({ passkeyId }),
      });
      mutateApi("/api/auth/passkeys");
      toast.success("Passkey removed");
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Could not remove passkey");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Fingerprint className="h-4 w-4" /> Passkeys & biometrics
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!supported ? (
          <p className="text-sm text-muted-foreground">Your browser doesn't support passkeys. Try Chrome, Safari, or Edge.</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Use your device's fingerprint, face, or security key to sign in without a password.
            </p>
            <Button size="sm" onClick={handleRegister} disabled={isRegistering}>
              <Fingerprint className="mr-1.5 h-4 w-4" />
              {isRegistering ? "Registering…" : "Add passkey"}
            </Button>
          </>
        )}
        {passkeys.length > 0 && (
          <div className="space-y-2 pt-2">
            {passkeys.map((pk) => (
              <div key={pk.id} className="flex items-center gap-3 rounded-lg border p-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Fingerprint className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{pk.deviceName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    Added {relTime(pk.createdAt)}
                    {pk.lastUsedAt && <> · Last used {relTime(pk.lastUsedAt)}</>}
                  </p>
                </div>
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => handleRemove(pk.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
