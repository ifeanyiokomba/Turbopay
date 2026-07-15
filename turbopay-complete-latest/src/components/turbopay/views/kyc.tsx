"use client";

import * as React from "react";
import { toast } from "sonner";
import { ShieldCheck, BadgeCheck, Lock, Check, ArrowRight, AlertCircle, UserCheck, FileCheck } from "lucide-react";
import { useApi, apiPost, mutateApi } from "@/lib/turbopay/client";
import { formatNaira } from "@/lib/turbopay/money";
import { KYC_LIMITS, type KycTier } from "@/lib/turbopay/types";
import { useApp } from "@/components/turbopay/store";
import { PageHeader, StatCard } from "@/components/turbopay/parts/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface KycData {
  tier: KycTier;
  status: string;
  record: { tier: number; status: string; provider: string; verifiedAt: string | null; firstName: string | null; lastName: string | null } | null;
  limits: { singleTxKobo: number; dailyTxKobo: number; balanceKobo: number; label: string };
  allLimits: Record<number, { singleTxKobo: number; dailyTxKobo: number; balanceKobo: number; label: string }>;
}

/** Countries that use NIN/BVN verification (Dojah/Paystack). */
const NIN_BVN_COUNTRIES = new Set(["NG", "GH"]);

export function KycView() {
  const user = useApp((s) => s.user);
  const setUser = useApp((s) => s.setUser);
  const { data, isLoading, refetch } = useApi<KycData>("/api/kyc");

  const [tier2Open, setTier2Open] = React.useState(false);
  const [tier3Open, setTier3Open] = React.useState(false);
  const [identityOpen, setIdentityOpen] = React.useState(false);

  const country = user?.country ?? "NG";
  const isNinBvnCountry = NIN_BVN_COUNTRIES.has(country);

  const refreshUser = async () => {
    await refetch();
    try {
      const me = await fetch("/api/auth/me").then((r) => r.json());
      if (me?.data) setUser(me.data);
    } catch { /* ignore */ }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="KYC & Limits" description="Verify your identity to unlock higher limits." icon={<ShieldCheck className="h-5 w-5" />} />

      {isLoading || !data ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : (
        <>
          {/* Current status */}
          <Card className="overflow-hidden">
            <div className="flex flex-col gap-4 bg-primary/5 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                  <ShieldCheck className="h-7 w-7" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Current verification level</p>
                  <p className="text-lg font-bold">{KYC_LIMITS[data.tier].label}</p>
                  <Badge variant={data.status === "VERIFIED" ? "default" : "secondary"} className="mt-1">{data.status}</Badge>
                </div>
              </div>
              {data.record?.verifiedAt && (
                <p className="text-xs text-muted-foreground">Verified on {new Date(data.record.verifiedAt).toLocaleDateString("en-NG")}</p>
              )}
            </div>
          </Card>

          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Single transaction" value={formatNaira(data.limits.singleTxKobo)} />
            <StatCard label="Daily limit" value={formatNaira(data.limits.dailyTxKobo)} />
            <StatCard label="Max balance" value={data.limits.balanceKobo === Number.MAX_SAFE_INTEGER ? "Unlimited" : formatNaira(data.limits.balanceKobo)} />
          </div>

          {/* Tier cards — different layout for NIN/BVN countries vs international */}
          {isNinBvnCountry ? (
            <div className="grid gap-4 md:grid-cols-3">
              <TierCard
                tier={1}
                title="Tier 1 — Starter"
                desc="Phone & email"
                current={data.tier}
                limits={data.allLimits[1]}
                requirements={["Phone number", "Email address"]}
                done={data.tier >= 1}
                icon={<UserCheck className="h-5 w-5" />}
              />
              <TierCard
                tier={2}
                title="Tier 2 — Verified"
                desc="NIN verification"
                current={data.tier}
                limits={data.allLimits[2]}
                requirements={["Valid NIN (11 digits)", "Identity verified securely"]}
                done={data.tier >= 2}
                icon={<BadgeCheck className="h-5 w-5" />}
                onAction={data.tier < 2 ? () => setTier2Open(true) : undefined}
                actionLabel="Verify NIN"
              />
              <TierCard
                tier={3}
                title="Tier 3 — Premium"
                desc="BVN verification"
                current={data.tier}
                limits={data.allLimits[3]}
                requirements={["Valid BVN (11 digits)", "Phone must match BVN record", "Tier 2 completed first"]}
                done={data.tier >= 3}
                icon={<ShieldCheck className="h-5 w-5" />}
                onAction={data.tier >= 2 && data.tier < 3 ? () => setTier3Open(true) : undefined}
                actionLabel={data.tier < 2 ? "Complete Tier 2 first" : "Verify BVN"}
                locked={data.tier < 2}
              />
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <TierCard
                tier={1}
                title="Tier 1 — Starter"
                desc="Phone & email"
                current={data.tier}
                limits={data.allLimits[1]}
                requirements={["Phone number", "Email address"]}
                done={data.tier >= 1}
                icon={<UserCheck className="h-5 w-5" />}
              />
              <TierCard
                tier={2}
                title="Identity Verified"
                desc="Document verification"
                current={data.tier}
                limits={data.allLimits[2]}
                requirements={["Valid government-issued ID", "Identity verified securely"]}
                done={data.tier >= 2}
                icon={<FileCheck className="h-5 w-5" />}
                onAction={data.tier < 2 ? () => setIdentityOpen(true) : undefined}
                actionLabel="Verify Identity"
              />
            </div>
          )}

          {/* Verification forms */}
          {tier2Open && (
            <VerifyDialog
              open={tier2Open}
              onOpenChange={setTier2Open}
              tier={2}
              title="Tier 2 — NIN Verification"
              description="Enter your 11-digit National Identification Number. We verify it securely."
              fieldLabel="NIN"
              fieldPlaceholder="12345678901"
              maxLength={11}
              onVerified={async () => {
                await refreshUser();
                setTier2Open(false);
              }}
            />
          )}
          {tier3Open && (
            <VerifyDialog
              open={tier3Open}
              onOpenChange={setTier3Open}
              tier={3}
              title="Tier 3 — BVN Verification"
              description="Enter your 11-digit Bank Verification Number. Your registered phone must match."
              fieldLabel="BVN"
              fieldPlaceholder="12345678901"
              maxLength={11}
              onVerified={async () => {
                await refreshUser();
                setTier3Open(false);
              }}
            />
          )}
          {identityOpen && (
            <IdentityVerifyDialog
              open={identityOpen}
              onOpenChange={setIdentityOpen}
              onVerified={async () => {
                await refreshUser();
                setIdentityOpen(false);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

function TierCard({
  tier, title, desc, current, limits, requirements, done, icon, onAction, actionLabel, locked,
}: {
  tier: number; title: string; desc: string; current: number;
  limits: { singleTxKobo: number; dailyTxKobo: number; balanceKobo: number };
  requirements: string[]; done: boolean; icon: React.ReactNode;
  onAction?: () => void; actionLabel?: string; locked?: boolean;
}) {
  const isCurrent = current === tier;
  return (
    <Card className={cn("relative overflow-hidden", isCurrent && "border-primary ring-1 ring-primary")}>
      {isCurrent && <div className="absolute right-0 top-0 rounded-bl-lg bg-primary px-2.5 py-1 text-[10px] font-semibold text-primary-foreground">CURRENT</div>}
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", done ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>
            {done ? <Check className="h-5 w-5" /> : locked ? <Lock className="h-5 w-5" /> : icon}
          </div>
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <p className="text-xs text-muted-foreground">{desc}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1 text-sm">
          <Row label="Single tx" value={formatNaira(limits.singleTxKobo)} />
          <Row label="Daily" value={formatNaira(limits.dailyTxKobo)} />
          <Row label="Max balance" value={limits.balanceKobo === Number.MAX_SAFE_INTEGER ? "Unlimited" : formatNaira(limits.balanceKobo)} />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Requirements</p>
          {requirements.map((r) => (
            <p key={r} className="flex items-center gap-1.5 text-xs">
              {done ? <Check className="h-3 w-3 text-success" /> : <AlertCircle className="h-3 w-3 text-muted-foreground" />} {r}
            </p>
          ))}
        </div>
        {onAction && !done && (
          <Button className="w-full" size="sm" onClick={onAction} disabled={locked}>
            {actionLabel} {!locked && <ArrowRight className="ml-1 h-4 w-4" />}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between"><span className="text-muted-foreground">{label}</span><span className="font-medium tabular-nums">{value}</span></div>;
}

/** NIN/BVN verification dialog — used by NG/GH users. */
function VerifyDialog({
  open, onOpenChange, tier, title, description, fieldLabel, fieldPlaceholder, maxLength, onVerified,
}: {
  open: boolean; onOpenChange: (o: boolean) => void; tier: 2 | 3; title: string; description: string;
  fieldLabel: string; fieldPlaceholder: string; maxLength: number; onVerified: () => void;
}) {
  const [value, setValue] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const submit = async () => {
    if (value.length !== maxLength) return toast.error(`${fieldLabel} must be ${maxLength} digits`);
    setLoading(true);
    try {
      const res = await apiPost<{ ok: boolean; tier: number; name: string }>("/api/kyc", tier === 2 ? { tier: 2, nin: value } : { tier: 3, bvn: value });
      toast.success(`Verified! Welcome, ${res.name}.`);
      setValue("");
      onVerified();
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Verification failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{description}</p>
        <div className="space-y-1.5">
          <Label htmlFor="idval">{fieldLabel}</Label>
          <Input id="idval" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, "").slice(0, maxLength))} placeholder={fieldPlaceholder} className="text-lg font-medium tabular-nums tracking-wider" />
          <p className="text-xs text-muted-foreground">{value.length}/{maxLength} digits · Encrypted at rest (AES-256-GCM)</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="flex-1" onClick={submit} disabled={loading || value.length !== maxLength}>{loading ? "Verifying…" : "Verify"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Generic identity verification dialog — used by non-NG/GH users. */
function IdentityVerifyDialog({
  open, onOpenChange, onVerified,
}: {
  open: boolean; onOpenChange: (o: boolean) => void; onVerified: () => void;
}) {
  const [documentType, setDocumentType] = React.useState("passport");
  const [documentValue, setDocumentValue] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const placeholder = documentType === "passport" ? "AB1234567" : documentType === "drivers_license" ? "DL-12345678" : "ID-12345678";

  const submit = async () => {
    if (!documentValue.trim()) return toast.error("Document value is required");
    setLoading(true);
    try {
      const res = await apiPost<{ ok: boolean; tier: number; name: string }>("/api/kyc/verify", {
        documentType,
        documentValue: documentValue.trim(),
      });
      toast.success(`Verified! Welcome, ${res.name}.`);
      setDocumentValue("");
      onVerified();
    } catch (e: any) {
      if (e?.status === 401) return;
      toast.error(e.message ?? "Verification failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader><CardTitle className="text-base">Identity Verification</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">Verify your identity using a government-issued document.</p>
        <div className="space-y-1.5">
          <Label>Document type</Label>
          <Select value={documentType} onValueChange={setDocumentType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="passport">Passport</SelectItem>
              <SelectItem value="drivers_license">Driver&apos;s License</SelectItem>
              <SelectItem value="national_id">National ID</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="docValue">Document number</Label>
          <Input id="docValue" value={documentValue} onChange={(e) => setDocumentValue(e.target.value)} placeholder={placeholder} />
          <p className="text-xs text-muted-foreground">Enter the number from your {documentType.replace(/_/g, " ")}.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="flex-1" onClick={submit} disabled={loading || !documentValue.trim()}>{loading ? "Verifying…" : "Verify Identity"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
