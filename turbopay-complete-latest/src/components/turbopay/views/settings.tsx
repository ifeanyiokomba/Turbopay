"use client";

import * as React from "react";
import { Settings, User, Shield, Palette, Moon, Sun, Monitor, Bell, LogOut, Mail, Phone, ShieldCheck, Database, Globe, Lock, Camera, AtSign, FileText, Upload, KeyRound, Smartphone, Copy, Check, Download, Trash2, ShieldAlert, MapPin } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { useApp } from "@/components/turbopay/store";
import { apiPost, apiFetch } from "@/lib/turbopay/client";
import { maskEmail, maskPhone } from "@/lib/turbopay/mask";
import { PageHeader } from "@/components/turbopay/parts/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { AvatarUpload } from "@/components/turbopay/parts/avatar-upload";

export function SettingsView() {
  const user = useApp((s) => s.user);
  const logoutClient = useApp((s) => s.logoutClient);
  const setView = useApp((s) => s.setView);
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  const [showChangePassword, setShowChangePassword] = React.useState(false);
  const [showRecoverPin, setShowRecoverPin] = React.useState(false);
  // MFA — setup (enable) + disable dialogs. The setup dialog drives the
  // full multi-step enable flow: generate secret + backup codes, show the
  // otpauth URI for the user to paste into their authenticator app, then
  // verify a 6-digit code from the app to confirm enrollment.
  const [showMfaSetup, setShowMfaSetup] = React.useState(false);
  const [showMfaDisable, setShowMfaDisable] = React.useState(false);
  // NDPR data export + account deletion dialogs.
  const [exporting, setExporting] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  // MFA status — fetched on mount + refreshed after setup/disable so the
  // card displays the current state without a full page reload.
  const [mfaStatus, setMfaStatus] = React.useState<{ enabled: boolean; hasBackupCodes: boolean } | null>(null);
  React.useEffect(() => setMounted(true), []);

  // NDPR data-portability export — pulls the user's full data dump from
  // /api/profile/export and triggers a JSON file download client-side.
  const downloadData = React.useCallback(async () => {
    setExporting(true);
    try {
      const data = await apiFetch<any>("/api/profile/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `turbopay-data-${user?.email ?? "export"}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Your data export is ready");
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Could not export data");
    } finally {
      setExporting(false);
    }
  }, [user?.email]);

  const refreshMfa = React.useCallback(async () => {
    try {
      const res = await apiFetch<{ enabled: boolean; hasBackupCodes: boolean }>("/api/auth/mfa");
      setMfaStatus({ enabled: res.enabled, hasBackupCodes: res.hasBackupCodes });
    } catch {
      // Non-fatal — the card just shows the enable/disable button as if
      // MFA were off (the safer default).
      setMfaStatus({ enabled: false, hasBackupCodes: false });
    }
  }, []);
  React.useEffect(() => { refreshMfa(); }, [refreshMfa]);

  const doLogout = async () => {
    try { await apiPost("/api/auth/logout", {}); } catch { /* ignore */ }
    logoutClient();
    toast.success("Signed out");
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" description="Manage your profile, security & preferences." icon={<Settings className="h-5 w-5" />} />

      {/* PIN + Password at the top — the most important security settings */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Transaction PIN */}
        <TransactionPinCard />

        {/* Password & PIN management */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Shield className="h-4 w-4" /> Password & PIN</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Password</p>
                    <p className="text-xs text-muted-foreground">Change your login password</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => setShowChangePassword(true)}>Change</Button>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Transaction PIN</p>
                    <p className="text-xs text-muted-foreground">
                      {user?.hasTransactionPin ? "Reset your 4-digit PIN if you forgot it" : "Set your PIN first to enable recovery"}
                    </p>
                  </div>
                </div>
                {user?.hasTransactionPin ? (
                  <Button variant="outline" size="sm" onClick={() => setShowRecoverPin(true)}>Recover</Button>
                ) : (
                  <Button variant="outline" size="sm" disabled title="Set your PIN first">Recover</Button>
                )}
              </div>

              {/* MFA (TOTP authenticator) — real two-factor authentication.
                  The previous row was a decorative toggle that did nothing;
                  this opens the actual setup/disable flow backed by
                  /api/auth/mfa. */}
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <Smartphone className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium flex items-center gap-2">
                      Authenticator app
                      {mfaStatus?.enabled && (
                        <Badge variant="secondary" className="text-[10px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">Active</Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {mfaStatus?.enabled
                        ? "Two-factor authentication is on. A 6-digit code is required at sign-in."
                        : "Add a 6-digit code from your authenticator app at sign-in."}
                    </p>
                  </div>
                </div>
                {mfaStatus?.enabled ? (
                  <Button variant="outline" size="sm" onClick={() => setShowMfaDisable(true)}>Disable</Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setShowMfaSetup(true)}>Enable</Button>
                )}
              </div>
            </div>
            <Separator />
            <ToggleRow icon={<Bell className="h-4 w-4" />} label="Transaction notifications" description="Get notified for every transaction." defaultChecked />
            <Separator />
            <ToggleRow icon={<Mail className="h-4 w-4" />} label="Login alerts" description="Email me when someone logs in." defaultChecked />
          </CardContent>
        </Card>
      </div>

      {/* Large Transaction Shield — opt-in step-up OTP for high-value debits */}
      <LargeTxShieldCard />

      {/* Location Guard — opt-in step-up OTP when transacting from a new subnet */}
      <LocationGuardCard />

      {/* Remaining settings below */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Profile */}
        <ProfileCard />

        {/* Appearance */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Palette className="h-4 w-4" /> Appearance</CardTitle></CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">Choose how Turbopay looks to you.</p>
            <div className="grid grid-cols-3 gap-2">
              {([["light", Sun, "Light"], ["dark", Moon, "Dark"], ["system", Monitor, "System"]] as const).map(([val, Icon, label]) => (
                <button
                  key={val}
                  onClick={() => setTheme(val)}
                  className={`flex flex-col items-center gap-2 rounded-lg border p-4 text-xs font-medium transition-all ${mounted && theme === val ? "border-primary bg-primary/5 text-primary ring-1 ring-primary" : "hover:bg-accent"}`}
                >
                  <Icon className="h-5 w-5" />
                  {label}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Data & privacy */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Database className="h-4 w-4" /> Data & Privacy</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">Turbopay is NDPR-aware. Your BVN/NIN are encrypted at rest (AES-256-GCM) and never shared with third parties.</p>
            <Row icon={<Shield className="h-4 w-4" />} label="PII encryption" value="AES-256-GCM" />
            <Row icon={<Database className="h-4 w-4" />} label="Ledger" value="Double-entry · Immutable" />
            <Row icon={<ShieldCheck className="h-4 w-4" />} label="Audit trail" value="Enabled" />
            <Separator />
            <MarketingConsentToggle />
            <Separator />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={downloadData} disabled={exporting}>
                <Download className="mr-1.5 h-4 w-4" /> {exporting ? "Preparing…" : "Download my data"}
              </Button>
              <Button variant="outline" size="sm" className="text-destructive" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="mr-1.5 h-4 w-4" /> Delete account
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-destructive/30">
        <CardContent className="flex items-center justify-between py-4">
          <div>
            <p className="text-sm font-medium">Sign out</p>
            <p className="text-xs text-muted-foreground">End your current session on this device.</p>
          </div>
          <Button variant="outline" className="text-destructive" onClick={doLogout}><LogOut className="mr-1.5 h-4 w-4" /> Sign out</Button>
        </CardContent>
      </Card>

      {/* Change Password dialog */}
      <ChangePasswordDialog open={showChangePassword} onOpenChange={setShowChangePassword} />
      {/* Recover PIN dialog */}
      <RecoverPinDialog open={showRecoverPin} onOpenChange={setShowRecoverPin} />
      {/* MFA setup + disable dialogs */}
      <MfaSetupDialog
        open={showMfaSetup}
        onOpenChange={setShowMfaSetup}
        onDone={() => { setShowMfaSetup(false); refreshMfa(); }}
      />
      <MfaDisableDialog
        open={showMfaDisable}
        onOpenChange={setShowMfaDisable}
        onDone={() => { setShowMfaDisable(false); refreshMfa(); }}
      />
      <DeleteAccountDialog open={deleteOpen} onOpenChange={setDeleteOpen} />
    </div>
  );
}

/** Delete account dialog — password-confirmed soft-delete via /api/profile/delete. */
function DeleteAccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const logoutClient = useApp((s) => s.logoutClient);
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const submit = async () => {
    if (!password) return toast.error("Enter your password to confirm");
    setLoading(true);
    try {
      await apiPost("/api/profile/delete", { password });
      toast.success("Your account has been deleted. Sorry to see you go.");
      setPassword("");
      onOpenChange(false);
      // Server has revoked all sessions — clear local tokens + redirect to login.
      logoutClient();
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Could not delete account");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive"><Trash2 className="h-5 w-5" /> Delete account</DialogTitle>
          <DialogDescription>
            This permanently disables your account and signs you out everywhere. Your data is retained for the NDPR-mandated period then purged. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            You will lose access to your wallet, cards, savings, investments, and transaction history. Any pending disputes or scheduled payments will be cancelled.
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Confirm your password</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" onClick={submit} disabled={loading}>{loading ? "Deleting…" : "Permanently delete"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Change Password dialog — current password + new password. */
function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const save = async () => {
    if (!current) return toast.error("Enter your current password");
    if (next.length < 8) return toast.error("New password must be at least 8 characters");
    if (next !== confirm) return toast.error("Passwords do not match");
    setLoading(true);
    try {
      const res = await apiPost<{ ok: boolean; sessionToken?: string }>("/api/profile/password", { currentPassword: current, newPassword: next });
      toast.success("Password changed successfully");
      onOpenChange(false);
      setCurrent(""); setNext(""); setConfirm("");
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Could not change password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" /> Change password</DialogTitle>
          <DialogDescription>Enter your current password and choose a new one.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Current password</Label>
            <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="••••••••" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">New password</Label>
            <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="Min. 8 characters" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Confirm new password</Label>
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter new password" />
          </div>
          <Button className="w-full" onClick={save} disabled={loading}>
            {loading ? "Changing…" : "Change password"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Recover PIN dialog — OTP-based PIN reset. */
function RecoverPinDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [step, setStep] = React.useState<"otp" | "reset" | "done">("otp");
  const [otp, setOtp] = React.useState("");
  const [newPin, setNewPin] = React.useState("");
  const [confirmPin, setConfirmPin] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [attemptId, setAttemptId] = React.useState("");

  const sendOtp = async () => {
    setLoading(true);
    try {
      const res = await apiPost<{ attemptId: string; devOtp?: string }>("/api/auth/forgot-pin", {});
      setAttemptId(res.attemptId);
      setStep("reset");
      if (res.devOtp) {
        toast.info(`Dev OTP: ${res.devOtp} (use it to reset your PIN)`);
      } else {
        toast.success("OTP sent to your email/phone");
      }
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Could not send OTP");
    } finally {
      setLoading(false);
    }
  };

  const resetPin = async () => {
    if (otp.length !== 6) return toast.error("Enter the 6-digit OTP");
    if (newPin.length !== 4) return toast.error("PIN must be 4 digits");
    if (newPin !== confirmPin) return toast.error("PINs do not match");
    setLoading(true);
    try {
      await apiPost("/api/auth/reset-pin", { attemptId, otp, newPin });
      toast.success("PIN reset successfully");
      setStep("done");
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Could not reset PIN");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => { setStep("otp"); setOtp(""); setNewPin(""); setConfirmPin(""); setAttemptId(""); };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setTimeout(reset, 300); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Lock className="h-5 w-5 text-primary" /> Recover transaction PIN</DialogTitle>
          <DialogDescription>
            {step === "otp" && "We'll send a 6-digit OTP to your registered email/phone to verify your identity."}
            {step === "reset" && "Enter the OTP we sent you and choose a new 4-digit PIN."}
            {step === "done" && "Your PIN has been reset successfully."}
          </DialogDescription>
        </DialogHeader>
        {step === "otp" && (
          <div className="py-2">
            <Button className="w-full" onClick={sendOtp} disabled={loading}>
              {loading ? "Sending OTP…" : "Send OTP"}
            </Button>
          </div>
        )}
        {step === "reset" && (
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">6-digit OTP</Label>
              <Input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="123456" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">New 4-digit PIN</Label>
              <InputOTP maxLength={4} value={newPin} onChange={setNewPin}>
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                  <InputOTPSlot index={3} />
                </InputOTPGroup>
              </InputOTP>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Confirm PIN</Label>
              <InputOTP maxLength={4} value={confirmPin} onChange={setConfirmPin}>
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                  <InputOTPSlot index={3} />
                </InputOTPGroup>
              </InputOTP>
            </div>
            <Button className="w-full" onClick={resetPin} disabled={loading}>
              {loading ? "Resetting…" : "Reset PIN"}
            </Button>
          </div>
        )}
        {step === "done" && (
          <div className="py-2">
            <Button className="w-full" onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * MFA setup dialog — multi-step enable flow.
 *
 * 1. On open: call POST /api/auth/mfa { action: "setup" } to generate a
 *    TOTP secret + 8 backup codes. The server persists the secret in
 *    disabled state; the user must verify a code before it's activated.
 * 2. Show the otpauth URI (for paste-into-app authenticators) + the raw
 *    secret (for manual entry) + the 8 backup codes (with a "copy"
 *    button + a warning that they're only shown once).
 * 3. The user enters a 6-digit code from their authenticator app.
 *    POST /api/auth/mfa { action: "enable", token } — the server
 *    verifies the code + flips `mfaEnabled` to true.
 * 4. On success: close + onDone() (parent refreshes the status badge).
 *
 * To avoid adding a QR-code library dependency, we show the otpauth URI as
 * text + the raw base32 secret. Most authenticator apps (Google
 * Authenticator, Authy, 1Password, Bitwarden) accept either a paste-URI
 * or manual secret entry.
 */
function MfaSetupDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [setup, setSetup] = React.useState<{ secret: string; otpauthUrl: string; backupCodes: string[] } | null>(null);
  const [token, setToken] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [copiedSecret, setCopiedSecret] = React.useState(false);
  const [copiedUrl, setCopiedUrl] = React.useState(false);
  const [copiedCodes, setCopiedCodes] = React.useState(false);
  const [backupAck, setBackupAck] = React.useState(false);

  // Fetch the setup payload when the dialog opens (and reset on close).
  React.useEffect(() => {
    if (!open) {
      setSetup(null);
      setToken("");
      setBackupAck(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiPost<{ secret: string; otpauthUrl: string; backupCodes: string[] }>("/api/auth/mfa", { action: "setup" })
      .then((res) => {
        if (!cancelled) setSetup(res);
      })
      .catch((e: any) => {
        if (e?.status === 401) return;
        toast.error(e.message ?? "Could not start MFA setup");
        onOpenChange(false);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, onOpenChange]);

  const copy = async (text: string, which: "secret" | "url" | "codes") => {
    try {
      await navigator.clipboard.writeText(text);
      if (which === "secret") { setCopiedSecret(true); setTimeout(() => setCopiedSecret(false), 1500); }
      if (which === "url") { setCopiedUrl(true); setTimeout(() => setCopiedUrl(false), 1500); }
      if (which === "codes") { setCopiedCodes(true); setTimeout(() => setCopiedCodes(false), 1500); }
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };

  const enable = async () => {
    if (token.length !== 6) return toast.error("Enter the 6-digit code from your authenticator app");
    if (!backupAck) return toast.error("Confirm you've saved your backup codes");
    setLoading(true);
    try {
      await apiPost("/api/auth/mfa", { action: "enable", token });
      toast.success("Two-factor authentication enabled");
      onDone();
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Invalid verification code");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Smartphone className="h-5 w-5 text-primary" /> Set up authenticator app</DialogTitle>
          <DialogDescription>
            Add an authenticator app (Google Authenticator, Authy, 1Password) to require a 6-digit code at sign-in.
          </DialogDescription>
        </DialogHeader>

        {!setup ? (
          <div className="flex items-center justify-center py-8">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : (
          <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
            {/* Step 1 — enroll in authenticator app */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">1. Add to your authenticator app</Label>
              <p className="text-[11px] text-muted-foreground">
                Paste this URI into your app, or enter the secret manually with account name <code className="rounded bg-muted px-1">Turbopay</code>.
              </p>
              <div className="relative">
                <Input readOnly value={setup.otpauthUrl} className="pr-9 text-[11px] font-mono" />
                <button
                  type="button"
                  onClick={() => copy(setup.otpauthUrl, "url")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary"
                  aria-label="Copy otpauth URI"
                >
                  {copiedUrl ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
              <div className="relative">
                <Input readOnly value={setup.secret} className="pr-9 text-xs font-mono tracking-wider" />
                <button
                  type="button"
                  onClick={() => copy(setup.secret, "secret")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary"
                  aria-label="Copy secret"
                >
                  {copiedSecret ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>

            {/* Step 2 — save backup codes */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">2. Save your backup codes</Label>
              <p className="text-[11px] text-muted-foreground">
                These 8 codes are shown only once. Each can be used once to sign in if you lose your authenticator device. Store them somewhere safe.
              </p>
              <div className="rounded-lg border bg-muted/40 p-3">
                <div className="grid grid-cols-2 gap-1.5 font-mono text-sm">
                  {setup.backupCodes.map((c) => <div key={c} className="tracking-wider">{c}</div>)}
                </div>
                <div className="mt-2 flex justify-end">
                  <Button type="button" variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => copy(setup.backupCodes.join("\n"), "codes")}>
                    {copiedCodes ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                    Copy all
                  </Button>
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <input type="checkbox" checked={backupAck} onChange={(e) => setBackupAck(e.target.checked)} className="h-3.5 w-3.5 rounded" />
                I've saved these codes somewhere safe
              </label>
            </div>

            {/* Step 3 — verify a code from the app */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">3. Enter the 6-digit code from your app</Label>
              <InputOTP maxLength={6} value={token} onChange={setToken}>
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
            </div>
            <Button className="w-full" onClick={enable} disabled={loading || token.length !== 6 || !backupAck}>
              {loading ? "Enabling…" : "Enable two-factor authentication"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * MFA disable dialog — requires a 6-digit TOTP code (or a one-time backup
 * code) to disable MFA. This is the last-resort recovery path for users
 * who lost their authenticator device: they can disable MFA using a saved
 * backup code.
 */
function MfaDisableDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [token, setToken] = React.useState("");
  const [backupCode, setBackupCode] = React.useState("");
  const [mode, setMode] = React.useState<"totp" | "backup">("totp");
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setToken("");
      setBackupCode("");
      setMode("totp");
    }
  }, [open]);

  const disable = async () => {
    if (mode === "totp" && token.length !== 6) return toast.error("Enter the 6-digit code from your authenticator app");
    if (mode === "backup" && backupCode.trim().length < 4) return toast.error("Enter a backup code");
    setLoading(true);
    try {
      // Both modes send the same field name (`token`); the server route
      // detects which kind of code it is by format (6 digits = TOTP,
      // otherwise = backup code).
      await apiPost("/api/auth/mfa", { action: "disable", token: mode === "totp" ? token : backupCode });
      toast.success("Two-factor authentication disabled");
      onDone();
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Invalid verification code");
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = mode === "totp" ? token.length === 6 : backupCode.trim().length >= 4;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /> Disable two-factor authentication</DialogTitle>
          <DialogDescription>
            {mode === "totp"
              ? "Enter the 6-digit code from your authenticator app to confirm."
              : "Enter one of your saved backup codes to confirm."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {mode === "totp" ? (
            <div className="space-y-1.5">
              <Label className="text-xs">6-digit code</Label>
              <InputOTP maxLength={6} value={token} onChange={setToken}>
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label className="text-xs">Backup code</Label>
              <Input
                value={backupCode}
                onChange={(e) => setBackupCode(e.target.value.toUpperCase())}
                placeholder="XXXX-XXXX"
                className="font-mono tracking-widest text-center"
                autoFocus
              />
            </div>
          )}
          <Button className="w-full" onClick={disable} disabled={loading || !canSubmit}>
            {loading ? "Disabling…" : "Disable"}
          </Button>
          <button
            type="button"
            onClick={() => { setMode(mode === "totp" ? "backup" : "totp"); setToken(""); setBackupCode(""); }}
            className="w-full text-center text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            {mode === "totp" ? "Use a backup code instead" : "Use authenticator code instead"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ icon, label, value, badge }: { icon: React.ReactNode; label: string; value: string; badge?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-sm text-muted-foreground">{icon} {label}</span>
      <span className="flex items-center gap-2 text-sm font-medium">
        {value}
        {badge && <Badge variant="secondary" className="text-[10px]">{badge}</Badge>}
      </span>
    </div>
  );
}

function ToggleRow({ icon, label, description, defaultChecked }: { icon: React.ReactNode; label: string; description: string; defaultChecked?: boolean }) {
  const [on, setOn] = React.useState(!!defaultChecked);
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 text-muted-foreground">{icon}</span>
        <div>
          <Label className="text-sm font-medium cursor-pointer">{label}</Label>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <Switch checked={on} onCheckedChange={setOn} />
    </div>
  );
}

/**
 * Large Transaction Shield card — opt-in step-up OTP for high-value debits.
 *
 * When enabled, any debit (airtime, data, bills, transfer) whose amount is at
 * or above the user's configured threshold triggers a 6-digit OTP challenge
 * before the pipeline proceeds. The shield plugs into `debitPipeline` after
 * PIN verification and before the AML check; the OTP lifecycle reuses the
 * existing `requireStepUp` / `verifyStepUp` helpers from the security
 * service (5-minute TTL, single-use).
 *
 * Configuration is read from / persisted to `/api/security/large-tx-shield`.
 * The threshold is entered in naira on the client and converted to kobo on
 * the server (× 100). The minimum allowed threshold is ₦100 — a smaller
 * value would trigger step-up on every micro-debit, defeating the shield's
 * intent (catch high-value fraud, not annoy users on every transaction).
 */
function LargeTxShieldCard() {
  const [config, setConfig] = React.useState<{ enabled: boolean; thresholdNaira: number } | null>(null);
  const [enabled, setEnabled] = React.useState(false);
  const [threshold, setThreshold] = React.useState("1000");
  const [loading, setLoading] = React.useState(false);
  const [initialLoading, setInitialLoading] = React.useState(true);

  // Fetch the current config on mount.
  const refresh = React.useCallback(async () => {
    try {
      const cfg = await apiFetch<{ enabled: boolean; thresholdNaira: number }>("/api/security/large-tx-shield");
      setConfig(cfg);
      setEnabled(cfg.enabled);
      setThreshold(String(cfg.thresholdNaira));
    } catch (e: any) {
      if (e?.status === 401) return;
      // Non-fatal — the card shows the toggle as if the shield were off
      // (the safer default). The user can still try to enable it.
      setConfig({ enabled: false, thresholdNaira: 1000 });
      setEnabled(false);
      setThreshold("1000");
    } finally {
      setInitialLoading(false);
    }
  }, []);
  React.useEffect(() => { refresh(); }, [refresh]);

  const save = async () => {
    const naira = parseFloat(threshold.replace(/[^0-9.]/g, ""));
    if (isNaN(naira) || naira < 100) {
      toast.error("Threshold must be at least ₦100");
      return;
    }
    setLoading(true);
    try {
      const updated = await apiFetch<{ enabled: boolean; thresholdNaira: number }>("/api/security/large-tx-shield", {
        method: "PUT",
        body: JSON.stringify({ enabled, thresholdNaira: naira }),
      });
      setConfig(updated);
      setThreshold(String(updated.thresholdNaira));
      toast.success(updated.enabled ? "Large Transaction Shield enabled" : "Large Transaction Shield disabled");
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Could not update shield configuration");
      // Revert the toggle if the save failed.
      if (config) setEnabled(config.enabled);
    } finally {
      setLoading(false);
    }
  };

  const dirty = (config?.enabled !== enabled) || (config && parseFloat(threshold.replace(/[^0-9.]/g, "")) !== config.thresholdNaira);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4" />
          Large Transaction Shield
          {config?.enabled && (
            <Badge variant="secondary" className="text-[10px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">Active</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Require an additional OTP for transactions above this amount. When a debit (airtime, data, bills, transfer) reaches your threshold, we&apos;ll send a 6-digit code to verify it&apos;s really you before the payment goes through.
        </p>

        {initialLoading ? (
          <div className="h-20 animate-pulse rounded-lg bg-muted/50" />
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div>
                  <Label className="text-sm font-medium cursor-pointer">Enable shield</Label>
                  <p className="text-xs text-muted-foreground">Turn on step-up verification for high-value transactions.</p>
                </div>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1">
                <ShieldAlert className="h-3 w-3" /> Threshold (₦)
              </Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₦</span>
                <Input
                  type="number"
                  min={100}
                  step={100}
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  className="pl-8 text-sm"
                  disabled={!enabled}
                  placeholder="1000"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Transactions of ₦{threshold && !isNaN(parseFloat(threshold)) ? parseFloat(threshold).toLocaleString() : "1,000"} and above will require an OTP. Minimum is ₦100.
              </p>
            </div>

            <Button className="w-full" size="sm" onClick={save} disabled={loading || !dirty}>
              {loading ? "Saving…" : "Save shield settings"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Location Guard card — opt-in step-up OTP when transacting from a new subnet.
 *
 * When enabled, the debit pipeline extracts the /24 subnet of the request IP
 * and checks whether the user has any Device row whose stored IP falls in
 * that subnet. If not, the pipeline throws `StepUpRequiredError` (HTTP 403) —
 * the client reuses the same step-up OTP flow as the Large Transaction Shield
 * (`/api/security/large-tx-step-up`) to verify the user, then retries the
 * original debit.
 *
 * Configuration is read from / persisted to `/api/security/location-guard`.
 * The guard is OFF by default — users opt in here.
 */
function LocationGuardCard() {
  const [enabled, setEnabled] = React.useState(false);
  const [savedEnabled, setSavedEnabled] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [initialLoading, setInitialLoading] = React.useState(true);

  // Fetch the current config on mount.
  const refresh = React.useCallback(async () => {
    try {
      const cfg = await apiFetch<{ enabled: boolean }>("/api/security/location-guard");
      setEnabled(cfg.enabled);
      setSavedEnabled(cfg.enabled);
    } catch (e: any) {
      if (e?.status === 401) return;
      // Non-fatal — the card shows the toggle as if the guard were off
      // (the safer default). The user can still try to enable it.
      setEnabled(false);
      setSavedEnabled(false);
    } finally {
      setInitialLoading(false);
    }
  }, []);
  React.useEffect(() => { refresh(); }, [refresh]);

  const toggle = async (next: boolean) => {
    // Optimistic UI — flip the switch immediately. If the save fails, revert.
    setEnabled(next);
    setLoading(true);
    try {
      const updated = await apiFetch<{ enabled: boolean }>("/api/security/location-guard", {
        method: "PUT",
        body: JSON.stringify({ enabled: next }),
      });
      setSavedEnabled(updated.enabled);
      setEnabled(updated.enabled);
      toast.success(updated.enabled ? "Location Guard enabled" : "Location Guard disabled");
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Could not update Location Guard");
      // Revert the toggle if the save failed.
      setEnabled(savedEnabled);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MapPin className="h-4 w-4" />
          Location Guard
          {savedEnabled && (
            <Badge variant="secondary" className="text-[10px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">Active</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Require additional verification when transacting from a new location. When a debit (airtime, data, bills, transfer) comes from an IP subnet you&apos;ve never used before, we&apos;ll send a 6-digit code to verify it&apos;s really you before the payment goes through.
        </p>

        {initialLoading ? (
          <div className="h-14 animate-pulse rounded-lg bg-muted/50" />
        ) : (
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div className="flex items-start gap-2.5">
              <Globe className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div>
                <Label className="text-sm font-medium cursor-pointer">Enable Location Guard</Label>
                <p className="text-xs text-muted-foreground">Step-up OTP when transacting from a new /24 subnet.</p>
              </div>
            </div>
            <Switch checked={enabled} onCheckedChange={toggle} disabled={loading} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TransactionPinCard() {
  const user = useApp((s) => s.user);
  const setUser = useApp((s) => s.setUser);
  const [showSetup, setShowSetup] = React.useState(!user?.hasTransactionPin);
  const [showChange, setShowChange] = React.useState(false);
  const hasPin = user?.hasTransactionPin;

  // If user has no PIN, show prominent setup card
  if (!hasPin) {
    return (
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Lock className="h-4 w-4 text-primary" /> Set up Transaction PIN</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-xs">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <span>A 4-digit PIN is required for every debit (transfer, airtime, bills). Set one now to enable transactions.</span>
          </div>
          <SetPinForm
            onDone={() => {
              setShowSetup(false);
              // Refresh user to update hasTransactionPin
              fetch("/api/auth/me").then((r) => r.json()).then((me) => {
                if (me?.data) setUser(me.data);
              });
            }}
          />
        </CardContent>
      </Card>
    );
  }

  // If user has PIN, show minimal "Change PIN" button
  return (
    <>
      <Card>
        <CardContent className="flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Lock className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">Transaction PIN</p>
              <p className="text-xs text-muted-foreground">Your PIN is set. Click to change it.</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowChange(true)}>
            Change PIN
          </Button>
        </CardContent>
      </Card>
      <ChangePinDialog open={showChange} onOpenChange={setShowChange} />
    </>
  );
}

/** Inline form for setting a new PIN (no OTP needed for first-time setup) */
function SetPinForm({ onDone }: { onDone: () => void }) {
  const [pin, setPin] = React.useState("");
  const [confirmPin, setConfirmPin] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const save = async () => {
    if (pin.length !== 4) return toast.error("PIN must be 4 digits");
    if (pin !== confirmPin) return toast.error("PINs do not match");
    setLoading(true);
    try {
      await apiPost<{ ok: boolean }>("/api/auth/set-pin", { pin });
      toast.success("Transaction PIN set");
      onDone();
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Could not save PIN");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label className="text-xs">Set PIN</Label>
        <InputOTP maxLength={4} value={pin} onChange={setPin}>
          <InputOTPGroup>
            <InputOTPSlot index={0} />
            <InputOTPSlot index={1} />
            <InputOTPSlot index={2} />
            <InputOTPSlot index={3} />
          </InputOTPGroup>
        </InputOTP>
      </div>
      <div className="space-y-2">
        <Label className="text-xs">Confirm PIN</Label>
        <InputOTP maxLength={4} value={confirmPin} onChange={setConfirmPin}>
          <InputOTPGroup>
            <InputOTPSlot index={0} />
            <InputOTPSlot index={1} />
            <InputOTPSlot index={2} />
            <InputOTPSlot index={3} />
          </InputOTPGroup>
        </InputOTP>
      </div>
      <Button className="w-full" size="sm" onClick={save} disabled={loading || pin.length !== 4 || confirmPin.length !== 4}>
        {loading ? "Saving…" : "Set PIN"}
      </Button>
    </div>
  );
}

/** Dialog for changing an existing PIN — requires OTP verification */
function ChangePinDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [step, setStep] = React.useState<"otp" | "new" | "done">("otp");
  const [otp, setOtp] = React.useState("");
  const [attemptId, setAttemptId] = React.useState("");
  const [newPin, setNewPin] = React.useState("");
  const [confirmPin, setConfirmPin] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setStep("otp");
      setOtp("");
      setNewPin("");
      setConfirmPin("");
      setAttemptId("");
    }
  }, [open]);

  const sendOtp = async () => {
    setLoading(true);
    try {
      const res = await apiPost<{ attemptId: string; devOtp?: string }>("/api/auth/change-pin", { action: "request-otp" });
      setAttemptId(res.attemptId);
      setStep("new");
      if (res.devOtp) {
        toast.info(`Dev OTP: ${res.devOtp}`);
      } else {
        toast.success("OTP sent to your email/phone");
      }
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Could not send OTP");
    } finally {
      setLoading(false);
    }
  };

  const changePin = async () => {
    if (otp.length !== 6) return toast.error("Enter the 6-digit OTP");
    if (newPin.length !== 4) return toast.error("PIN must be 4 digits");
    if (newPin !== confirmPin) return toast.error("PINs do not match");
    setLoading(true);
    try {
      await apiPost("/api/auth/change-pin", { action: "change-pin", attemptId, otp, newPin });
      toast.success("Transaction PIN updated");
      setStep("done");
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Could not change PIN");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Lock className="h-5 w-5 text-primary" /> Change Transaction PIN</DialogTitle>
          <DialogDescription>
            {step === "otp" && "We'll send a 6-digit OTP to verify your identity before changing your PIN."}
            {step === "new" && "Enter the OTP and choose a new 4-digit PIN."}
            {step === "done" && "Your PIN has been updated successfully."}
          </DialogDescription>
        </DialogHeader>
        {step === "otp" && (
          <div className="py-2">
            <Button className="w-full" onClick={sendOtp} disabled={loading}>
              {loading ? "Sending OTP…" : "Send OTP"}
            </Button>
          </div>
        )}
        {step === "new" && (
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">6-digit OTP</Label>
              <Input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="123456" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">New 4-digit PIN</Label>
              <InputOTP maxLength={4} value={newPin} onChange={setNewPin}>
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                  <InputOTPSlot index={3} />
                </InputOTPGroup>
              </InputOTP>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Confirm PIN</Label>
              <InputOTP maxLength={4} value={confirmPin} onChange={setConfirmPin}>
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                  <InputOTPSlot index={3} />
                </InputOTPGroup>
              </InputOTP>
            </div>
            <Button className="w-full" onClick={changePin} disabled={loading || otp.length !== 6 || newPin.length !== 4}>
              {loading ? "Updating…" : "Update PIN"}
            </Button>
          </div>
        )}
        {step === "done" && (
          <div className="py-2">
            <Button className="w-full" onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProfileCard() {
  const user = useApp((s) => s.user);
  const setUser = useApp((s) => s.setUser);
  const [fullName, setFullName] = React.useState(user?.fullName ?? "");
  const [username, setUsername] = React.useState(user?.username ?? "");
  const [avatarUrl, setAvatarUrl] = React.useState(user?.avatarUrl ?? "");
  const [bio, setBio] = React.useState(user?.bio ?? "");
  const [loading, setLoading] = React.useState(false);
  const [showChangePhone, setShowChangePhone] = React.useState(false);
  const [showChangeEmail, setShowChangeEmail] = React.useState(false);

  // Determine if fields are KYC-locked
  const isKycVerified = (user?.kycTier ?? 0) >= 2 && user?.kycStatus === "VERIFIED";
  const isFullNameLocked = isKycVerified; // fullName is verified via NIN/BVN

  const save = async () => {
    setLoading(true);
    try {
      const updated = await apiFetch<any>("/api/profile", {
        method: "PATCH",
        body: JSON.stringify({
          // Don't send fullName if it's KYC-locked
          fullName: isFullNameLocked ? undefined : (fullName !== user?.fullName ? fullName : undefined),
          username: username !== user?.username ? username : undefined,
          avatarUrl: avatarUrl !== user?.avatarUrl ? avatarUrl : undefined,
          bio: bio !== user?.bio ? bio : undefined,
        }),
      });
      // Refresh session user
      const me = await fetch("/api/auth/me").then((r) => r.json());
      if (me?.data) setUser(me.data);
      toast.success("Profile updated");
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Could not update profile");
    } finally {
      setLoading(false);
    }
  };

  const initials = (user?.fullName ?? "U").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><User className="h-4 w-4" /> Profile</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {/* Avatar preview + upload with crop */}
        <div className="flex items-center gap-4">
          <Avatar className="h-16 w-16 border-2 overflow-hidden">
            <AvatarImage src={avatarUrl || user?.avatarUrl || undefined} alt="Profile" />
            <AvatarFallback className="bg-primary/10 text-lg font-semibold text-primary">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 space-y-2">
            <Label className="text-xs flex items-center gap-1"><Camera className="h-3 w-3" /> Profile Photo</Label>
            <div className="flex gap-2">
              <AvatarUpload
                currentAvatarUrl={avatarUrl || user?.avatarUrl}
                onUploaded={(url) => { setAvatarUrl(url); toast.success("Profile photo updated"); }}
              />
              {avatarUrl && (
                <Button type="button" size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => setAvatarUrl("")}>
                  Remove
                </Button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">JPG, PNG, or WebP. You can crop after selecting.</p>
          </div>
        </div>

        <Separator />

        {/* Full name — locked if KYC verified */}
        <div className="space-y-1.5">
          <Label className="text-xs flex items-center gap-1">
            <User className="h-3 w-3" /> Full name
            {isFullNameLocked && <Lock className="h-3 w-3 text-muted-foreground" />}
          </Label>
          {isFullNameLocked ? (
            <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2">
              <Input value={fullName} readOnly className="text-sm bg-transparent border-0 p-0 h-auto focus-visible:ring-0" />
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">Verified via NIN</span>
            </div>
          ) : (
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} className="text-sm" />
          )}
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs flex items-center gap-1"><AtSign className="h-3 w-3" /> Username</Label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">@</span>
            <Input value={username} onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase())} className="pl-8 text-sm" placeholder="your_username" maxLength={20} />
          </div>
          <p className="text-[11px] text-muted-foreground">3-20 chars. Can be used to sign in.</p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs flex items-center gap-1"><FileText className="h-3 w-3" /> Bio <span className="text-muted-foreground">(optional)</span></Label>
          <Textarea value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Tell us about yourself..." rows={2} maxLength={200} className="text-sm" />
        </div>

        <Separator />

        {/* Contact info — with OTP-protected change buttons */}
        <div className="space-y-2">
          <Label className="text-xs font-medium">Contact information</Label>
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Email</p>
                  <p className="text-xs text-muted-foreground">{user ? maskEmail(user.email) : "—"}</p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => setShowChangeEmail(true)}>Change</Button>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Phone</p>
                  <p className="text-xs text-muted-foreground">{user ? user?.phone ? maskPhone(user.phone) : "Not set" : "—"}</p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => setShowChangePhone(true)}>Change</Button>
            </div>
          </div>
        </div>

        <div className="space-y-1.5 text-xs text-muted-foreground">
          <div className="flex justify-between"><span>KYC</span><span>Tier {user?.kycTier} · {user?.kycStatus}</span></div>
          <div className="flex justify-between"><span>Member since</span><span>{user ? new Date(user.createdAt).toLocaleDateString("en-NG", { year: "numeric", month: "short", day: "numeric" }) : "—"}</span></div>
        </div>

        <Button className="w-full" size="sm" onClick={save} disabled={loading || isFullNameLocked}>
          {loading ? "Saving…" : "Save profile"}
        </Button>
      </CardContent>

      {/* OTP dialogs for phone/email changes */}
      <ChangeContactDialog
        open={showChangePhone}
        onOpenChange={setShowChangePhone}
        field="phone"
        currentValue={user?.phone ?? undefined}
        label="Phone number"
      />
      <ChangeContactDialog
        open={showChangeEmail}
        onOpenChange={setShowChangeEmail}
        field="email"
        currentValue={user?.email ?? undefined}
        label="Email address"
      />
    </Card>
  );
}

/** Dialog for changing phone/email with OTP verification */
function ChangeContactDialog({
  open,
  onOpenChange,
  field,
  currentValue,
  label,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  field: "phone" | "email";
  currentValue?: string;
  label: string;
}) {
  const setUser = useApp((s) => s.setUser);
  const [step, setStep] = React.useState<"otp" | "new" | "done">("otp");
  const [otp, setOtp] = React.useState("");
  const [newValue, setNewValue] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setStep("otp");
      setOtp("");
      setNewValue("");
    }
  }, [open]);

  const sendOtp = async () => {
    setLoading(true);
    try {
      await apiPost("/api/profile", { action: "request-otp", field });
      toast.success(`OTP sent to your current ${field === "email" ? "email" : "phone"}`);
      setStep("new");
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Could not send OTP");
    } finally {
      setLoading(false);
    }
  };

  const change = async () => {
    if (!newValue) return toast.error(`Enter your new ${label.toLowerCase()}`);
    if (field === "email" && !newValue.includes("@")) return toast.error("Enter a valid email");
    if (field === "phone" && newValue.length < 7) return toast.error("Enter a valid phone number");
    if (otp.length !== 6) return toast.error("Enter the 6-digit OTP");

    setLoading(true);
    try {
      await apiFetch("/api/profile", {
        method: "PATCH",
        body: JSON.stringify({ [field]: newValue, otp }),
      });
      toast.success(`${label} updated successfully`);
      // Refresh session user
      const me = await fetch("/api/auth/me").then((r) => r.json());
      if (me?.data) setUser(me.data);
      setStep("done");
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? `Could not update ${label.toLowerCase()}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change {label}</DialogTitle>
          <DialogDescription>
            {step === "otp" && `We'll send a 6-digit OTP to verify your identity.`}
            {step === "new" && `Enter the OTP and your new ${label.toLowerCase()}.`}
            {step === "done" && `${label} updated successfully.`}
          </DialogDescription>
        </DialogHeader>
        {step === "otp" && (
          <div className="py-2">
            <Button className="w-full" onClick={sendOtp} disabled={loading}>
              {loading ? "Sending OTP…" : "Send OTP"}
            </Button>
          </div>
        )}
        {step === "new" && (
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">6-digit OTP</Label>
              <Input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="123456" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">New {label.toLowerCase()}</Label>
              <Input
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder={field === "email" ? "new@email.com" : "+234..."}
                type={field === "email" ? "email" : "tel"}
              />
            </div>
            <Button className="w-full" onClick={change} disabled={loading || otp.length !== 6 || !newValue}>
              {loading ? "Updating…" : "Update"}
            </Button>
          </div>
        )}
        {step === "done" && (
          <div className="py-2">
            <Button className="w-full" onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Marketing consent toggle ──────────────────────────────
function MarketingConsentToggle() {
  const [consent, setConsent] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    apiFetch<{ marketingConsent: boolean }>("/api/profile/consent")
      .then((data) => setConsent(data.marketingConsent))
      .catch(() => {});
  }, []);

  const toggle = async (checked: boolean) => {
    setLoading(true);
    try {
      await apiFetch("/api/profile/consent", {
        method: "PATCH",
        body: JSON.stringify({ marketingConsent: checked }),
      });
      setConsent(checked);
      toast.success(checked ? "Marketing emails enabled" : "Marketing emails disabled");
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error("Could not update preference");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium">Marketing emails</p>
        <p className="text-xs text-muted-foreground">Receive updates about new features and promotions.</p>
      </div>
      <Switch checked={consent} onCheckedChange={toggle} disabled={loading} />
    </div>
  );
}
