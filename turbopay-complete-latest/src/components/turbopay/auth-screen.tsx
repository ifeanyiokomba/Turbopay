"use client";

import * as React from "react";
import { toast } from "sonner";
import { ArrowRight, ArrowLeft, Eye, EyeOff, Lock, Mail, Phone, ShieldCheck, User, Zap, CheckCircle2, KeyRound, Gift, Check, X, MessageCircle, Loader2 } from "lucide-react";
import { apiPost, setIframeToken } from "@/lib/turbopay/client";
import type { SessionUser } from "@/lib/turbopay/types";
import { useApp } from "@/components/turbopay/store";
import { Logo, Wordmark } from "@/components/turbopay/logo";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { CountrySelector } from "@/components/turbopay/parts/country-selector";

const FEATURES = [
  { icon: Zap, title: "Instant wallet funding", desc: "Via your dedicated Monnify virtual account." },
  { icon: ShieldCheck, title: "Bank-grade ledger", desc: "Double-entry, immutable, NDPR-aligned." },
  { icon: User, title: "KYC tiers", desc: "Tier 1 → 3 limits with NIN & BVN verification." },
];

/**
 * Type guard for the login response union. The login route returns either
 * a direct-login response (SessionUser + tokens) or an MFA challenge
 * ({ mfaRequired, userId, hasBackupCodes }). Using a type guard (rather
 * than the `in` operator inline) reliably narrows the union's negation
 * branch after an early `return`.
 */
type LoginResponse =
  | (SessionUser & { sessionToken: string; refreshToken: string })
  | { mfaRequired: true; userId: string; hasBackupCodes: boolean };
function isMfaChallenge(res: LoginResponse): res is { mfaRequired: true; userId: string; hasBackupCodes: boolean } {
  return typeof res === "object" && res !== null && "mfaRequired" in res && (res as { mfaRequired: unknown }).mfaRequired === true;
}

export function AuthScreen({ onBack, initialTab = "login" }: { onBack?: () => void; initialTab?: "login" | "register" }) {
  const setUser = useApp((s) => s.setUser);
  const [tab, setTab] = React.useState<"login" | "register">(initialTab);
  const [loading, setLoading] = React.useState(false);
  const [showForgot, setShowForgot] = React.useState(false);
  // MFA challenge — populated when /api/auth/login returns `mfaRequired: true`.
  // The MFA dialog takes this userId + the TOTP/backup code and calls
  // /api/auth/mfa/verify to complete login.
  const [mfaChallenge, setMfaChallenge] = React.useState<{ userId: string; hasBackupCodes: boolean } | null>(null);

  // login
  const [identifier, setIdentifier] = React.useState("");
  const [loginPass, setLoginPass] = React.useState("");

  // register — First name, Middle name (optional), Last name
  const [firstName, setFirstName] = React.useState("");
  const [middleName, setMiddleName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [regUsername, setRegUsername] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [country, setCountry] = React.useState("NG");
  const [phone, setPhone] = React.useState("+234");
  const [regPass, setRegPass] = React.useState("");
  const [referralCode, setReferralCode] = React.useState("");

  const [showPass, setShowPass] = React.useState(false);
  const [termsAccepted, setTermsAccepted] = React.useState(false);
  const [showVerify, setShowVerify] = React.useState(false);
  const [verifyTarget, setVerifyTarget] = React.useState("");
  const [verifyPhone, setVerifyPhone] = React.useState("");
  const [verifyChannel, setVerifyChannel] = React.useState<"EMAIL" | "SMS" | "WHATSAPP">("EMAIL");
  const [pendingOtp, setPendingOtp] = React.useState("");

  const doLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      // The login response is either:
      //   - { mfaRequired: true, userId, hasBackupCodes } — MFA challenge
      //   - SessionUser & { sessionToken, refreshToken } — direct login
      // We discriminate via the `isMfaChallenge` type guard (declared at
      // module scope) — the `in` operator alone doesn't reliably narrow
      // the union's negation branch after an early return.
      const res = await apiPost<LoginResponse>("/api/auth/login", { identifier, password: loginPass });
      if (isMfaChallenge(res)) {
        // Password verified, but MFA is enabled. Open the MFA challenge
        // dialog — the user submits a TOTP code (or backup code) and we
        // call /api/auth/mfa/verify to complete login.
        setMfaChallenge({ userId: res.userId, hasBackupCodes: res.hasBackupCodes });
        toast.info("Enter the 6-digit code from your authenticator app.");
        return;
      }
      setUser(res);
      toast.success(`Welcome back, ${res.fullName.split(" ")[0]}!`);
    } catch (err: any) {
      // If email isn't verified, switch to the verification UI.
      if (err?.code === "EMAIL_NOT_VERIFIED") {
        // Use the identifier as the target if it's an email; otherwise use
        // the phone (the user may have logged in with phone or username).
        const target = identifier.includes("@") ? identifier : "";
        setVerifyTarget(target);
        setVerifyChannel("EMAIL");
        setPendingOtp("");
        setShowVerify(true);
        toast.info("Please verify your email to continue.");
      } else {
        toast.error(err.message ?? "Login failed");
      }
    } finally {
      setLoading(false);
    }
  };

  const doRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    // Combine names: "First Middle Last" (middle optional)
    const fullName = [firstName.trim(), middleName.trim(), lastName.trim()].filter(Boolean).join(" ");
    if (!firstName.trim() || !lastName.trim()) {
      toast.error("First name and last name are required");
      return;
    }
    setLoading(true);
    try {
      const u = await apiPost<SessionUser & { sessionToken: string; refreshToken: string; hasTransactionPin: boolean; devOtp?: string }>('/api/auth/register', {
        fullName, username: regUsername || undefined, email, country, phone, password: regPass,
        referralCode: referralCode.trim() || undefined,
        verifyChannel: "EMAIL",
        privacyPolicyAccepted: termsAccepted,
      });
      // Don't setUser yet — the user must verify first.
      // Email is the default channel; alternatives (SMS/WhatsApp) are offered
      // in the verification dialog after email attempts fail.
      setVerifyTarget(email);
      setVerifyPhone(phone);
      setVerifyChannel("EMAIL");
      setPendingOtp(u.devOtp ?? "");
      setShowVerify(true);
      toast.success("Account created! Check your email for the verification code.");
    } catch (err: any) {
      if (err?.status === 401) return;
      toast.error(err.message ?? "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background lg:grid lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-primary p-10 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
        <div className="tp-grain absolute inset-0 opacity-30" />
        <div className="relative flex items-center gap-2">
          <Logo size={40} />
          <Wordmark className="text-xl" />
        </div>
        <div className="relative">
          <h2 className="max-w-md text-3xl font-bold leading-tight tracking-tight">
            The fast lane to your money.
          </h2>
          <p className="mt-3 max-w-md text-sm text-primary-foreground/80">
            Turbopay is a modern Nigerian wallet & payments platform — fund, transfer, buy airtime
            & data, and pay bills in seconds.
          </p>
          <div className="mt-8 space-y-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 backdrop-blur">
                  <f.icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-medium">{f.title}</p>
                  <p className="text-xs text-primary-foreground/70">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative text-xs text-primary-foreground/60">
          © {new Date().getFullYear()} Turbopay Technologies · NDPR-aware · CBN-aligned partners
        </div>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center p-5 sm:p-8">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center gap-2 lg:hidden">
            <Logo size={36} />
            <Wordmark className="text-lg" />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Welcome to Turbopay</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Sign in or create your wallet in under a minute.
              </p>
            </div>
            {onBack && (
              <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                ← Back
              </button>
            )}
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="mt-6">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="register">Create account</TabsTrigger>
              <TabsTrigger value="login">Sign in</TabsTrigger>
            </TabsList>

            {/* LOGIN */}
            <TabsContent value="login" className="mt-5">
              <form onSubmit={doLogin} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="identifier">Email or phone</Label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="identifier"
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      className="pl-9"
                      placeholder="you@example.com"
                      autoComplete="username"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="loginPass">Password</Label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="loginPass"
                      type={showPass ? "text" : "password"}
                      value={loginPass}
                      onChange={(e) => setLoginPass(e.target.value)}
                      className="pl-9 pr-9"
                      placeholder="••••••••"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass((s) => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label="Toggle password"
                    >
                      {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Signing in…" : "Sign in"}
                  {!loading && <ArrowRight className="ml-1 h-4 w-4" />}
                </Button>
                <div className="text-center">
                  <button type="button" onClick={() => setShowForgot(true)} className="text-xs text-muted-foreground hover:text-primary transition-colors">
                    Forgot password?
                  </button>
                </div>
              </form>
            </TabsContent>

            {/* REGISTER */}
            <TabsContent value="register" className="mt-5">
              <form onSubmit={doRegister} className="space-y-3.5">
                {/* First name + Last name (row) */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="firstName">First name</Label>
                    <div className="relative">
                      <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} className="pl-9" placeholder="Adaeze" required />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="lastName">Last name</Label>
                    <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Okafor" required />
                  </div>
                </div>
                {/* Middle name (optional) */}
                <div className="space-y-1.5">
                  <Label htmlFor="middleName">Middle name <span className="text-muted-foreground">(optional)</span></Label>
                  <Input id="middleName" value={middleName} onChange={(e) => setMiddleName(e.target.value)} placeholder="Chidinma" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="country">Country</Label>
                  <CountrySelector value={country} onChange={setCountry} />
                  <p className="text-[11px] text-muted-foreground">Determines your default currency and available features.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="username">Username <span className="text-muted-foreground">(optional)</span></Label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">@</span>
                    <Input id="username" value={regUsername} onChange={(e) => setRegUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase())} className="pl-8" placeholder="adaeze" maxLength={20} />
                  </div>
                  <p className="text-[11px] text-muted-foreground">3-20 chars. Letters, numbers, underscores. Can be used to sign in.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email <span className="text-muted-foreground">(optional)</span></Label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="pl-9" placeholder="you@example.com" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Phone <span className="text-muted-foreground">(optional)</span></Label>
                  <div className="relative">
                    <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="pl-9" placeholder="+2348012345678" />
                  </div>
                  <p className="text-[11px] text-muted-foreground">At least one of email or phone is required. Format: +country code + number.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="regPass">Password</Label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input id="regPass" type={showPass ? "text" : "password"} value={regPass} onChange={(e) => setRegPass(e.target.value)} className="pl-9 pr-9" placeholder="Min. 8 characters" required />
                    <button type="button" onClick={() => setShowPass((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {/* Password strength checklist — ticks when each rule is met */}
                  {regPass.length > 0 && <PasswordChecklist password={regPass} />}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="referralCode">Referral code <span className="text-muted-foreground">(optional)</span></Label>
                  <div className="relative">
                    <Gift className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="referralCode"
                      value={referralCode}
                      onChange={(e) => setReferralCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                      className="pl-9"
                      placeholder="TURBOXXXX"
                      autoComplete="off"
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">Referred by a friend? Enter their code to earn a welcome bonus.</p>
                </div>

                {/* No channel selector — verification uses whichever contact
                    method was provided (email or phone). If both provided,
                    email is used by default. */}

                {/* Terms of Service + Privacy Policy acceptance — required to
                    create a wallet. Links open in a new tab so the user can
                    read them without losing the form state. */}
                <div className="flex items-start gap-2">
                  <Checkbox id="terms" checked={termsAccepted} onCheckedChange={(v) => setTermsAccepted(v === true)} className="mt-0.5" />
                  <Label htmlFor="terms" className="text-xs text-muted-foreground leading-relaxed">
                    I agree to the <a href="/terms" target="_blank" className="text-primary hover:underline">Terms of Service</a> and <a href="/privacy" target="_blank" className="text-primary hover:underline">Privacy Policy</a>.
                  </Label>
                </div>

                <Button type="submit" className="w-full" disabled={loading || !termsAccepted}>
                  {loading ? "Creating wallet…" : "Create wallet"}
                  {!loading && <ArrowRight className="ml-1 h-4 w-4" />}
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          {/* Divider */}
          <div className="mt-5">
            <div className="relative">
              <Separator />
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-2 text-[11px] uppercase text-muted-foreground">
                or
              </span>
            </div>
          </div>

          {/* Google OAuth */}
          <GoogleSignInButton setUser={setUser} />
        </div>
      </div>

      <ForgotPasswordDialog open={showForgot} onOpenChange={setShowForgot} />

      {/* MFA challenge — shown when /api/auth/login returns mfaRequired.
          The user submits a 6-digit TOTP code (or a one-time backup code)
          to /api/auth/mfa/verify to complete login. */}
      <MfaChallengeDialog
        challenge={mfaChallenge}
        onClose={() => setMfaChallenge(null)}
        onVerified={(u) => { setUser(u); setMfaChallenge(null); }}
      />

      {/* Verification — shown after registration or when an unverified
          user tries to log in. Supports Email / SMS / WhatsApp channels. */}
      <VerifyDialog
        open={showVerify}
        onOpenChange={setShowVerify}
        target={verifyTarget}
        phone={verifyPhone}
        channel={verifyChannel}
        onChannelChange={setVerifyChannel}
        devOtp={pendingOtp}
        onVerified={(u) => { setUser(u); setShowVerify(false); }}
      />
    </div>
  );
}

/**
 * MFA challenge dialog — the second step of login when MFA (TOTP) is enabled.
 *
 * After the user's password is verified, the login route returns
 * `{ mfaRequired: true, userId }` instead of a session token. The user
 * must then enter a 6-digit TOTP code from their authenticator app — OR,
 * if they lost their device, a one-time backup code (shown once at setup
 * time). We POST { userId, token } or { userId, backupCode } to
 * /api/auth/mfa/verify; on success that route returns the session tokens
 * + user object (same shape as the login response), and we store the
 * tokens + setUser to complete login.
 *
 * The "Use a backup code" toggle is only shown if the user has backup
 * codes stored (the login route returns hasBackupCodes as a hint).
 */
function MfaChallengeDialog({
  challenge,
  onClose,
  onVerified,
}: {
  challenge: { userId: string; hasBackupCodes: boolean } | null;
  onClose: () => void;
  onVerified: (u: SessionUser & { sessionToken: string; refreshToken: string }) => void;
}) {
  const [token, setToken] = React.useState("");
  const [backupCode, setBackupCode] = React.useState("");
  const [mode, setMode] = React.useState<"totp" | "backup">("totp");
  const [loading, setLoading] = React.useState(false);

  // Reset state when the dialog closes / reopens with a new challenge.
  React.useEffect(() => {
    if (challenge) {
      setToken("");
      setBackupCode("");
      setMode("totp");
    }
  }, [challenge]);

  const submit = async () => {
    if (!challenge) return;
    if (mode === "totp" && token.length !== 6) return toast.error("Enter the 6-digit code");
    if (mode === "backup" && backupCode.trim().length < 4) return toast.error("Enter a backup code");
    setLoading(true);
    try {
      const u = await apiPost<SessionUser & { sessionToken: string; refreshToken: string }>(
        "/api/auth/mfa/verify",
        mode === "totp"
          ? { userId: challenge.userId, token }
          : { userId: challenge.userId, backupCode },
      );
      toast.success(`Welcome back, ${u.fullName.split(" ")[0]}!`);
      onVerified(u);
    } catch (e: any) {
      if (e?.status === 401) return; // global auth-expired handler takes over
      toast.error(e.message ?? "Invalid verification code");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={!!challenge} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" /> Two-factor authentication
          </DialogTitle>
          <DialogDescription>
            {mode === "totp"
              ? "Enter the 6-digit code from your authenticator app to finish signing in."
              : "Enter one of the 8 backup codes you saved when you set up MFA."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
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
              <p className="text-[11px] text-muted-foreground">
                Each backup code can only be used once.
              </p>
            </div>
          )}
          <Button className="w-full" onClick={submit} disabled={loading || (mode === "totp" ? token.length !== 6 : backupCode.trim().length < 4)}>
            {loading ? "Verifying…" : "Verify & sign in"}
            {!loading && <ArrowRight className="ml-1 h-4 w-4" />}
          </Button>
          {challenge?.hasBackupCodes && (
            <button
              type="button"
              onClick={() => { setMode(mode === "totp" ? "backup" : "totp"); setToken(""); setBackupCode(""); }}
              className="w-full text-center text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              {mode === "totp" ? "Use a backup code instead" : "Use authenticator code instead"}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Verification dialog — multi-channel (Email / SMS / WhatsApp). The user can
 * switch channels, resend the code, and enter the 6-digit OTP to verify.
 */
function VerifyDialog({ open, onOpenChange, target, phone, channel, onChannelChange, devOtp, onVerified }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  target: string;
  phone: string;
  channel: "EMAIL" | "SMS" | "WHATSAPP";
  onChannelChange: (c: "EMAIL" | "SMS" | "WHATSAPP") => void;
  devOtp?: string;
  onVerified: (u: SessionUser) => void;
}) {
  const [otp, setOtp] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [currentDevOtp, setCurrentDevOtp] = React.useState(devOtp);
  const [failedAttempts, setFailedAttempts] = React.useState(0);

  // The target to verify — depends on the channel.
  const verifyTarget = channel === "EMAIL" ? target : phone;

  // Show alternative channels (SMS/WhatsApp) only after 2+ failed attempts
  // with the current channel. Email is the primary method.
  const showAlternatives = failedAttempts >= 2;

  const verify = async () => {
    if (otp.length !== 6) return toast.error("Enter the 6-digit code");
    setLoading(true);
    try {
      await apiPost("/api/auth/verify/confirm", { target: verifyTarget, otp, purpose: "EMAIL_VERIFY" });
      toast.success("Verified! Logging you in…");
      const { apiFetch } = await import("@/lib/turbopay/client");
      const u = await apiFetch<SessionUser>("/api/auth/me");
      onVerified(u);
    } catch (e: any) {
      if (e?.status === 401) return;
      const newCount = failedAttempts + 1;
      setFailedAttempts(newCount);
      if (newCount >= 2 && channel === "EMAIL") {
        toast.error("Code incorrect. Try again, or switch to SMS / WhatsApp below.");
      } else {
        toast.error(e.message ?? "Verification failed");
      }
    } finally {
      setLoading(false);
    }
  };

  const resend = async (newChannel?: "EMAIL" | "SMS" | "WHATSAPP") => {
    const ch = newChannel ?? channel;
    try {
      const res = await apiPost<{ devOtp?: string }>("/api/auth/verify/send", {
        target: ch === "EMAIL" ? target : phone,
        channel: ch,
        purpose: "EMAIL_VERIFY",
      });
      if (res.devOtp) setCurrentDevOtp(res.devOtp);
      toast.success(`Code sent via ${ch === "EMAIL" ? "email" : ch === "SMS" ? "SMS" : "WhatsApp"}`);
    } catch (e: any) {
      toast.error(e.message ?? "Could not resend code");
    }
  };

  const switchChannel = (ch: "EMAIL" | "SMS" | "WHATSAPP") => {
    onChannelChange(ch);
    setOtp("");
    setCurrentDevOtp(undefined);
    resend(ch);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {channel === "EMAIL" && <Mail className="h-5 w-5 text-primary" />}
            {channel === "SMS" && <Phone className="h-5 w-5 text-primary" />}
            {channel === "WHATSAPP" && <MessageCircle className="h-5 w-5 text-primary" />}
            Verify your account
          </DialogTitle>
          <DialogDescription>
            We sent a 6-digit code to{" "}
            <strong>{channel === "EMAIL" ? target : phone}</strong>{" "}
            via {channel === "EMAIL" ? "email" : channel === "SMS" ? "SMS" : "WhatsApp"}.
            Enter it below to activate your account.
            {currentDevOtp && (
              <span className="mt-2 block rounded bg-primary/10 p-2 text-center text-sm font-medium text-primary">
                Dev OTP: {currentDevOtp}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Channel switcher — only shown after 2+ failed attempts with email.
            Email is the primary verification method; SMS/WhatsApp are fallbacks. */}
        {showAlternatives && (
          <div className="space-y-2">
            <p className="text-center text-xs text-muted-foreground">
              Having trouble with email? Try an alternative:
            </p>
            <div className="grid grid-cols-3 gap-2">
              {([
                { val: "EMAIL", label: "Email", icon: Mail },
                { val: "SMS", label: "SMS", icon: Phone },
                { val: "WHATSAPP", label: "WhatsApp", icon: MessageCircle },
              ] as const).map((opt) => (
                <button
                  key={opt.val}
                  type="button"
                  onClick={() => switchChannel(opt.val)}
                  className={`flex flex-col items-center gap-1 rounded-lg border p-2 text-[11px] font-medium transition-all ${channel === opt.val ? "border-primary bg-primary/5 text-primary ring-1 ring-primary" : "hover:bg-accent"}`}
                >
                  <opt.icon className="h-3.5 w-3.5" />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">6-digit verification code</Label>
            <Input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="123456" className="text-center text-lg tracking-widest" />
          </div>
          <Button className="w-full" onClick={verify} disabled={loading || otp.length !== 6}>
            {loading ? "Verifying…" : "Verify"}
          </Button>
          <button type="button" onClick={() => resend()} className="w-full text-center text-xs text-muted-foreground hover:text-primary">
            Didn't receive a code? Resend
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Password checklist — shows each password requirement with a tick (✓) when
 * met and a cross (✗) when not. Guides the user during account creation.
 *
 * The 6th rule ("Not found in known data breaches") is checked ASYNCHRONOUSLY
 * against the HaveIBeenPwned corpus via `/api/auth/check-breach` (k-anonymity:
 * only the first 5 chars of the SHA-1 hash ever leave the browser). While the
 * check is in flight, the row shows a spinner; on success it shows ✓ (emerald)
 * if the password is clean or ✗ (red) if it appears in a breach corpus.
 */
function PasswordChecklist({ password }: { password: string }) {
  const rules = [
    { label: "At least 8 characters", met: password.length >= 8 },
    { label: "One uppercase letter (A-Z)", met: /[A-Z]/.test(password) },
    { label: "One lowercase letter (a-z)", met: /[a-z]/.test(password) },
    { label: "One number (0-9)", met: /[0-9]/.test(password) },
    { label: "One special character (!@#$%…)", met: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password) },
  ];
  const metCount = rules.filter((r) => r.met).length;

  // Async breach check — debounced 500ms, fail-open (network errors show as
  // "idle" so the user isn't blocked from submitting). Only runs once the
  // password is at least 8 chars (no point checking shorter ones).
  const breach = useBreachCheck(password, password.length >= 8);

  // A breached password overrides the strength verdict — even a "Strong"
  // password is unusable if it's in a breach corpus. The bar + label flip
  // to red until the user changes the password.
  const strength = breach === "breached"
    ? "Breached"
    : metCount <= 2 ? "Weak" : metCount <= 4 ? "Good" : "Strong";
  const strengthColor = breach === "breached"
    ? "text-red-500"
    : metCount <= 2 ? "text-red-500" : metCount <= 4 ? "text-amber-500" : "text-emerald-500";
  const barColor = breach === "breached"
    ? "bg-red-500"
    : metCount <= 2 ? "bg-red-500" : metCount <= 4 ? "bg-amber-500" : "bg-emerald-500";
  const barWidth = breach === "breached" ? 100 : (metCount / rules.length) * 100;

  return (
    <div className="mt-1.5 rounded-md border bg-muted/30 p-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground">Password strength</span>
        <span className={`text-[11px] font-semibold ${strengthColor}`}>{strength}</span>
      </div>
      <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${barWidth}%` }}
        />
      </div>
      <div className="grid grid-cols-1 gap-1">
        {rules.map((rule, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[11px]">
            {rule.met ? (
              <Check className="h-3 w-3 shrink-0 text-emerald-500" />
            ) : (
              <X className="h-3 w-3 shrink-0 text-muted-foreground/50" />
            )}
            <span className={rule.met ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>
              {rule.label}
            </span>
          </div>
        ))}
        {/* 6th rule — async breach check. Spinner while checking, ✓ emerald
            if safe, ✗ red if the password appears in known data breaches. */}
        <div className="flex items-center gap-1.5 text-[11px]">
          {breach === "checking" ? (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
          ) : breach === "safe" ? (
            <Check className="h-3 w-3 shrink-0 text-emerald-500" />
          ) : breach === "breached" ? (
            <X className="h-3 w-3 shrink-0 text-red-500" />
          ) : (
            <X className="h-3 w-3 shrink-0 text-muted-foreground/50" />
          )}
          <span
            className={
              breach === "safe"
                ? "text-emerald-600 dark:text-emerald-400"
                : breach === "breached"
                  ? "font-medium text-red-600 dark:text-red-400"
                  : "text-muted-foreground"
            }
          >
            Not found in known data breaches
            {breach === "checking" && <span className="text-muted-foreground"> (checking…)</span>}
            {breach === "breached" && (
              <span className="text-red-600 dark:text-red-400"> — please choose a different password</span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Debounced async breach-check hook. Calls `/api/auth/check-breach` 500ms
 * after the password stops changing. Cancels in-flight timers on every
 * change so a fast typist doesn't fire a request per keystroke. Fails open:
 * on any error (network, 429, 500), returns to "idle" so the user is never
 * blocked from submitting — the server re-checks authoritatively on submit.
 */
function useBreachCheck(password: string, canCheck: boolean): "idle" | "checking" | "safe" | "breached" {
  const [state, setState] = React.useState<"idle" | "checking" | "safe" | "breached">("idle");

  React.useEffect(() => {
    if (!canCheck) {
      setState("idle");
      return;
    }
    setState("checking");

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await apiPost<{ breached: boolean }>("/api/auth/check-breach", { password });
        if (!cancelled) setState(res.breached ? "breached" : "safe");
      } catch {
        // Network error, 429 (rate-limited), 500, etc. — fail open. The
        // server re-checks authoritatively on register submit, so a
        // transient client-side failure here is non-fatal.
        if (!cancelled) setState("idle");
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [password, canCheck]);

  return state;
}

function ForgotPasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [step, setStep] = React.useState<"identify" | "otp" | "done">("identify");
  const [identifier, setIdentifier] = React.useState("");
  const [otp, setOtp] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [showPass, setShowPass] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [devOtp, setDevOtp] = React.useState<string | null>(null);
  const [targetMasked, setTargetMasked] = React.useState<string>("");

  const reset = () => {
    setStep("identify");
    setIdentifier("");
    setOtp("");
    setNewPassword("");
    setDevOtp(null);
    setTargetMasked("");
  };

  const sendOtp = async () => {
    if (identifier.trim().length < 3) return toast.error("Enter your email, phone, or username");
    setLoading(true);
    try {
      const res = await apiPost<{ otpSent: boolean; devOtp?: string; target?: string }>("/api/auth/forgot-password", { identifier });
      setTargetMasked(res.target ?? "your contact");
      if (res.devOtp) {
        setDevOtp(res.devOtp);
        toast.success(`OTP sent (dev mode: ${res.devOtp})`);
      } else {
        toast.success("OTP sent to your email/phone");
      }
      setStep("otp");
    } catch (e: any) {
      toast.error(e.message ?? "Could not send OTP");
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async () => {
    if (otp.length !== 6) return toast.error("Enter the 6-digit OTP");
    if (newPassword.length < 8) return toast.error("Password must be at least 8 characters");
    setLoading(true);
    try {
      await apiPost("/api/auth/reset-password", { identifier, otp, newPassword });
      toast.success("Password reset successfully! Please sign in.");
      setStep("done");
    } catch (e: any) {
      toast.error(e.message ?? "Could not reset password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setTimeout(reset, 300); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" /> Reset Password</DialogTitle>
          <DialogDescription>
            {step === "identify" && "Enter your email, phone, or username. We'll send you a verification code."}
            {step === "otp" && `Enter the 6-digit code sent to ${targetMasked}, then set a new password.`}
            {step === "done" && "Your password has been reset."}
          </DialogDescription>
        </DialogHeader>

        {step === "identify" && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="fp-identifier">Email, phone, or username</Label>
              <Input
                id="fp-identifier"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="you@example.com"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sendOtp(); } }}
                autoFocus
              />
            </div>
            <Button className="w-full" onClick={sendOtp} disabled={loading}>
              {loading ? "Sending…" : "Send verification code"}
            </Button>
          </div>
        )}

        {step === "otp" && (
          <div className="space-y-3">
            {devOtp && (
              <div className="rounded-lg border bg-warning/10 p-2.5 text-center text-sm">
                <p className="text-xs text-muted-foreground">Dev mode OTP (in production this is sent via SMS/email):</p>
                <p className="font-mono text-lg font-bold tracking-widest text-warning-foreground">{devOtp}</p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Verification code</Label>
              <InputOTP maxLength={6} value={otp} onChange={setOtp}>
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
            <div className="space-y-1.5">
              <Label htmlFor="fp-newpass">New password</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="fp-newpass"
                  type={showPass ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="pl-9 pr-9"
                  placeholder="Min. 8 characters"
                />
                <button type="button" onClick={() => setShowPass((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">Min 8 chars, include upper + lower + number + special.</p>
            </div>
            <Button className="w-full" onClick={resetPassword} disabled={loading || otp.length !== 6 || newPassword.length < 8}>
              {loading ? "Resetting…" : "Reset password"}
            </Button>
            <button onClick={() => setStep("identify")} className="flex w-full items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-3 w-3" /> Use a different account
            </button>
          </div>
        )}

        {step === "done" && (
          <div className="space-y-3 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success/15">
              <CheckCircle2 className="h-6 w-6 text-success" />
            </div>
            <p className="text-sm font-medium">Password reset successfully</p>
            <p className="text-xs text-muted-foreground">You can now sign in with your new password.</p>
            <Button className="w-full" onClick={() => { onOpenChange(false); setTimeout(reset, 300); }}>
              Back to sign in
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Google Sign-In Button ───────────────────────────────────

function GoogleSignInButton({ setUser }: { setUser: (u: SessionUser) => void }) {
  const [loading, setLoading] = React.useState(false);
  const buttonRef = React.useRef<HTMLDivElement>(null);

  // Render the Google button using the GIS library.
  React.useEffect(() => {
    if (!buttonRef.current) return;
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) return; // Google OAuth not configured — button stays hidden

    let cancelled = false;

    function tryRender() {
      const google = (window as any).google;
      if (!google?.accounts?.id) {
        // GIS script not loaded yet — retry in 200ms.
        setTimeout(tryRender, 200);
        return;
      }
      if (cancelled || !buttonRef.current) return;
      google.accounts.id.initialize({
        client_id: clientId,
        callback: handleCredentialResponse,
      });
      google.accounts.id.renderButton(buttonRef.current, {
        theme: "outline",
        size: "large",
        width: buttonRef.current.offsetWidth || 320,
        text: "continue_with",
        shape: "rect",
        locale: "en",
      });
    }

    function handleCredentialResponse(response: any) {
      if (!response.credential) return;
      setLoading(true);
      apiPost<SessionUser>("/api/auth/google", { credential: response.credential })
        .then((u) => {
          setUser(u);
          toast.success(`Welcome, ${u.fullName.split(" ")[0]}!`);
        })
        .catch((e: any) => {
          toast.error(e.message ?? "Google sign-in failed");
        })
        .finally(() => setLoading(false));
    }

    tryRender();
    return () => { cancelled = true; };
  }, [setUser]);

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  // If Google OAuth is not configured, show a fallback button that explains
  // the feature is available (so the user knows it exists).
  if (!clientId) {
    return (
      <div className="mt-4">
        <button
          type="button"
          disabled
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-input bg-background px-4 py-2.5 text-sm font-medium text-muted-foreground opacity-60"
          title="Set NEXT_PUBLIC_GOOGLE_CLIENT_ID to enable Google sign-in"
        >
          <GoogleIcon className="h-4 w-4" />
          Continue with Google (coming soon)
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col items-center gap-2">
      {loading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Signing in with Google…
        </p>
      )}
      <div ref={buttonRef} className="w-full flex justify-center" style={{ minHeight: 40 }} />
    </div>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="24" height="24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}
